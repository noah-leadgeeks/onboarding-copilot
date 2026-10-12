/**
 * Step 5 read endpoints: 200 shape, 403 wrong scope, 404 unknown id, 400 bad query, DB errors as
 * 500 `database_error` with no catalog/proxy fallback (M9), and `/me.limits` from env config.
 */
import { getTableColumns } from 'drizzle-orm';
import {
  activities,
  diaryEntries,
  diaryTopics,
  feedbackEntries,
  feedbackSessions,
  monthlyReviews,
  sessionLogs,
  timelineStages,
  trainingModules,
} from '@/lib/db/schema';
import { FEEDBACK_SESSIONS } from '@/lib/feedback';
import { OFFICIAL_SCHEDULE_ACTIVITIES } from '@/lib/schedule-catalog';
import { SCHEDULE_SELECTION } from '@/lib/agent/read/schedule';
import { createFakeAgentDb, pgError, positionalRows, type FakeAgentDb, type FakeQuery } from '@/lib/agent/testing/fake-db';
import { generateAgentToken } from '@/lib/agent/tokens';

// jest.mock is not hoisted by this repo's transform, so it runs before the routes are required below.
let mockFake: FakeAgentDb = createFakeAgentDb();
jest.mock('@/lib/db', () => ({
  isDbConfigured: () => {
    const url = process.env.DATABASE_URL || '';
    return url.startsWith('postgres://') || url.startsWith('postgresql://');
  },
  get db() {
    return mockFake.db;
  },
}));

type RouteGet = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
function load(path: string): RouteGet {
  return (require(path) as { GET: RouteGet }).GET;
}

const routes = {
  today: load('./today/route'),
  schedule: load('./schedule/route'),
  scheduleItem: load('./schedule/[id]/route'),
  diary: load('./diary/route'),
  diaryItem: load('./diary/[rowNumber]/route'),
  feedback: load('./feedback/route'),
  reviews: load('./reviews/route'),
  timeline: load('./timeline/route'),
  glossary: load('./glossary/route'),
  sessions: load('./sessions/route'),
  me: load('./me/route'),
};

const ENV_KEYS = [
  'DATABASE_URL',
  'AGENT_RATE_LIMIT_READS_PER_MIN',
  'AGENT_RATE_LIMIT_PROPOSALS_PER_MIN',
  'AGENT_MAX_PENDING_PROPOSALS',
  'SHEETS_SCHEDULE_URL',
  'GOOGLE_SHEETS_ID',
] as const;
const FAKE_DB_URL = 'postgres://fake:fake@db.invalid:5432/fake';
const BASE = 'http://localhost/api/agent/v1';

interface Body {
  ok: boolean;
  error?: string;
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- response JSON is asserted structurally
}

// ---------------------------------------------------------------------------------------------
// Fixtures (positional rows are produced from these objects in selection order)
// ---------------------------------------------------------------------------------------------

const ACTIVITY_ROWS = [
  activity(10, '01/09/2026', 'Week 1', 'Done', 'Welcome session'),
  activity(11, '02/09/2026', 'Week 1', 'Done', 'Account setup'),
  activity(12, '02/09/2026', 'Week 1', 'In Progress', 'Product tour'),
  activity(13, '02/09/2026', 'Week 1', '', 'Codebase walkthrough'),
  activity(14, '03/09/2026', 'Week 1', '', 'Pairing day'),
  activity(20, '08/09/2026', 'Week 2', 'Reschedule', 'Architecture deep dive'),
];

function activity(row: number, date: string, week: string, progress: string, topic: string): Record<string, unknown> {
  return {
    id: `act-${row}`,
    rowNumber: row,
    week,
    day: 'Tuesday',
    date,
    activityCount: 1,
    pic: 'Team Lead',
    topic,
    mainMedia: 'Online Meeting',
    durationMinutes: row === 10 ? 45 : null,
    startTime: '09:00',
    endTime: '10:00',
    progress,
    materialsLink: '',
    notes: `notes ${row}`,
    actualStart: row === 10 ? '09:05' : null,
    actualEnd: null,
    updatedAt: `2026-09-0${(row % 9) + 1} 03:04:05.123456+00`,
  };
}

const DIARY_TOPICS = [
  { id: 'topic-5', rowNumber: 5, day: 'Tuesday', week: 'Week 1', date: '01/09/2026', activityCount: '1', pic: 'HR', topic: 'Orientation', defaultLearned: 'default learned', defaultNotes: 'default notes', createdAt: '2026-09-01 00:00:00+00' },
  { id: 'topic-6', rowNumber: 6, day: 'Wednesday', week: 'Week 1', date: '02/09/2026', activityCount: '1', pic: 'IT', topic: 'Laptop', defaultLearned: null, defaultNotes: null, createdAt: '2026-09-01 00:00:00+00' },
];
const DIARY_ENTRIES = [{ id: 'entry-6', rowNumber: 6, learned: 'Set up the VPN', notes: 'took long', updatedAt: '2026-09-02T05:00:00.000Z' }];

const FEEDBACK_ENTRIES = [
  {
    id: 'fb-row-3',
    sessionId: 'row-3',
    rowNumber: 3,
    date: '2026-09-02',
    pic: 'Managing Director',
    topic: 'Introduction to Company',
    ratings: { communication: 6, alignment: 5, understanding: 5, readiness: 4, pace: 5, overall: 5 },
    hasQuestions: true,
    questionExplanation: 'q',
    questionAddressing: 'Chat response is fine',
    suggestions: 's',
    updatedAt: '2026-09-02T06:00:00.000Z',
  },
];

const REVIEWS = [
  { id: 'month-1', month: 1, achievements: 'a', challenges: 'c', goalsNextMonth: 'g', technicalRatings: { t1: 80, bad: 'x' }, valuesRatings: null, updatedAt: '2026-10-01T00:00:00.000Z' },
];

const STAGES = [
  { id: 'stage-1', stageNumber: '1', stageName: 'Orientation', startDate: '01/09/2026', endDate: '30/09/2026', objective: 'o', keyActivities: 'k', outputsEvidence: 'e', minimumDuration: '1 Month', completedEvidence: ['one', 2], updatedAt: null },
];

const MODULES = [
  { id: 'mod-1', topic: 'Git', pic: 'IT', objectives: 'o', frameworkMaterials: 'f', materials: 'm', media: 'Video', durationMinutes: 30, materialAccess: null, materialLinks: [{ label: 'L', url: 'https://example.com', type: 'link' }], notes: null, createdAt: '2026-09-01 00:00:00+00' },
];

const SESSION_LOGS = [
  { id: 's1', activityId: 'act-10', name: 'Welcome session', startedAt: Date.UTC(2026, 8, 1, 2, 0), finishedAt: Date.UTC(2026, 8, 1, 2, 45), durationMinutes: 45, createdAt: '2026-09-01 02:45:00+00' },
];

let feedbackSessionRows: Array<Record<string, unknown>> = [];

/** Simulates the read queries. Filters `where <table>.<col> = $1` lookups by their parameter. */
function answer(query: FakeQuery): unknown[][] | undefined {
  const { sql, params } = query;
  const byParam = <T extends Record<string, unknown>>(rows: T[], key: string): T[] =>
    sql.includes(' where ') && !sql.includes(' and ') && params.length > 0 ? rows.filter((row) => row[key] === params[0]) : rows;
  if (sql.includes('from "activities"')) return positionalRows(SCHEDULE_SELECTION, byParam(ACTIVITY_ROWS, 'id'));
  if (sql.includes('from "diary_topics"')) return positionalRows(getTableColumns(diaryTopics), byParam(DIARY_TOPICS, 'rowNumber'));
  if (sql.includes('from "diary_entries"')) return positionalRows(getTableColumns(diaryEntries), byParam(DIARY_ENTRIES, 'rowNumber'));
  if (sql.includes('from "feedback_sessions"')) return positionalRows(getTableColumns(feedbackSessions), feedbackSessionRows);
  if (sql.includes('from "feedback_entries"')) return positionalRows(getTableColumns(feedbackEntries), FEEDBACK_ENTRIES);
  if (sql.includes('from "monthly_reviews"')) return positionalRows(getTableColumns(monthlyReviews), REVIEWS);
  if (sql.includes('from "timeline_stages"')) return positionalRows(getTableColumns(timelineStages), STAGES);
  if (sql.includes('from "training_modules"')) return positionalRows(getTableColumns(trainingModules), MODULES);
  if (sql.includes('from "session_logs"')) return positionalRows(getTableColumns(sessionLogs), SESSION_LOGS);
  return undefined;
}

/** Asserts that `actual` has every key of `subset` with an equal value (test globals lack toMatchObject). */
function expectSubset(actual: unknown, subset: Record<string, unknown>): void {
  const record = (actual ?? {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(subset)) picked[key] = record[key];
  expect(picked).toEqual(subset);
}

function addToken(scopes: string[]): string {
  const generated = generateAgentToken();
  mockFake.tokens.push({
    id: `tok_${mockFake.tokens.length + 1}`,
    name: 'openclaw laptop',
    tokenPrefix: generated.prefix,
    tokenHash: generated.hash,
    scopes,
    expiresAt: '2027-01-01 00:00:00+00',
    revoked: false,
    expired: false,
  });
  return generated.token;
}

async function call(get: RouteGet, path: string, token: string, params: Record<string, string> = {}): Promise<{ status: number; body: Body; text: string; res: Response }> {
  const res = await get(new Request(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }), {
    params: Promise.resolve(params),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Body, text, res };
}

describe('/api/agent/v1 read endpoints', () => {
  const savedEnv = new Map<string, string | undefined>();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  beforeAll(() => {
    for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.DATABASE_URL = FAKE_DB_URL;
    mockFake = createFakeAgentDb();
    mockFake.data = answer;
    feedbackSessionRows = [];
    fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('network access is blocked in tests');
    }) as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
    expect(fetchCalls).toBe(0);
  });

  afterAll(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // -------------------------------------------------------------------------------------------
  // Scope, unknown-query and audit behaviour common to every endpoint
  // -------------------------------------------------------------------------------------------

  const ENDPOINTS: Array<{ name: keyof typeof routes; path: string; params?: Record<string, string>; scope: string | null; action: string }> = [
    { name: 'today', path: '/today', scope: 'schedule:read', action: 'read.today' },
    { name: 'schedule', path: '/schedule', scope: 'schedule:read', action: 'read.schedule' },
    { name: 'scheduleItem', path: '/schedule/act-12', params: { id: 'act-12' }, scope: 'schedule:read', action: 'read.schedule' },
    { name: 'diary', path: '/diary', scope: 'diary:read', action: 'read.diary' },
    { name: 'diaryItem', path: '/diary/6', params: { rowNumber: '6' }, scope: 'diary:read', action: 'read.diary' },
    { name: 'feedback', path: '/feedback', scope: 'feedback:read', action: 'read.feedback' },
    { name: 'reviews', path: '/reviews', scope: 'reviews:read', action: 'read.reviews' },
    { name: 'timeline', path: '/timeline', scope: 'timeline:read', action: 'read.timeline' },
    { name: 'glossary', path: '/glossary', scope: 'glossary:read', action: 'read.glossary' },
    { name: 'sessions', path: '/sessions', scope: 'sessions:read', action: 'read.sessions' },
    { name: 'me', path: '/me', scope: null, action: 'read.me' },
  ];

  for (const endpoint of ENDPOINTS) {
    describe(`GET ${endpoint.path}`, () => {
      it('returns 200 { ok, data } with no-store and finalizes a read.* audit row without the query string', async () => {
        const token = addToken([endpoint.scope ?? 'glossary:read']);
        const { status, body, res } = await call(routes[endpoint.name], endpoint.path, token, endpoint.params);
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.data).toBeDefined();
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(mockFake.audit).toHaveLength(1);
        expectSubset(mockFake.audit[0], { action: endpoint.action, status_code: 200, path: `/api/agent/v1${endpoint.path}` });
      });

      if (endpoint.scope) {
        it(`returns 403 insufficient_scope without ${endpoint.scope}`, async () => {
          const other = endpoint.scope === 'glossary:read' ? 'diary:read' : 'glossary:read';
          const token = addToken([other, 'diary:propose']);
          const { status, body } = await call(routes[endpoint.name], endpoint.path, token, endpoint.params);
          expect(status).toBe(403);
          expect(body.error).toBe('insufficient_scope');
          expectSubset(mockFake.audit[0], { action: 'insufficient_scope', status_code: 403 });
          expect(mockFake.queries.some((q) => /from "(activities|diary_|feedback_|monthly|timeline|training|session_logs)/.test(q.sql))).toBe(false);
        });
      } else {
        it('accepts a token with any single scope', async () => {
          const token = addToken(['sessions:read']);
          expect((await call(routes[endpoint.name], endpoint.path, token, endpoint.params)).status).toBe(200);
        });
      }

      it('returns 400 invalid_query for an unknown or repeated query parameter', async () => {
        const token = addToken([endpoint.scope ?? 'glossary:read']);
        const unknown = await call(routes[endpoint.name], `${endpoint.path}?bogus=1`, token, endpoint.params);
        expect(unknown.status).toBe(400);
        expect(unknown.body.error).toBe('invalid_query');
        expectSubset(mockFake.audit[0], { action: endpoint.action, status_code: 400, path: `/api/agent/v1${endpoint.path}` });
      });

      it('returns 503 agent_api_requires_database without DATABASE_URL', async () => {
        const token = addToken([endpoint.scope ?? 'glossary:read']);
        delete process.env.DATABASE_URL;
        const { status, body } = await call(routes[endpoint.name], endpoint.path, token, endpoint.params);
        expect(status).toBe(503);
        expect(body.error).toBe('agent_api_requires_database');
      });

      if (endpoint.name !== 'me') {
        it('maps a database error to 500 database_error', async () => {
          const token = addToken([endpoint.scope ?? 'glossary:read']);
          mockFake.data = () => {
            throw pgError('08006', 'connection lost with secret detail');
          };
          const { status, body, text } = await call(routes[endpoint.name], endpoint.path, token, endpoint.params);
          expect(status).toBe(500);
          expect(body.error).toBe('database_error');
          expect(body.data).toBeUndefined();
          expect(text).not.toContain('secret detail');
          expectSubset(mockFake.audit[0], { action: endpoint.action, status_code: 500 });
        });
      }
    });
  }

  // -------------------------------------------------------------------------------------------
  // /today
  // -------------------------------------------------------------------------------------------

  describe('GET /today', () => {
    it('builds date, dayNumber, current, upcoming and done from the database schedule', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-02T03:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const token = addToken(['schedule:read']);
      const { status, body } = await call(routes.today, '/today', token);
      expect(status).toBe(200);
      expect(body.data.date).toBe('2026-09-02');
      expect(body.data.dayNumber).toBe(2);
      expect(body.data.current.id).toBe('act-12');
      expect(body.data.current.status).toBe('in-progress');
      expect(body.data.upcoming.map((a: { id: string }) => a.id)).toEqual(['act-13']);
      expect(body.data.done.map((a: { id: string }) => a.id)).toEqual(['act-11']);
      expect(body.data.current.updatedAt).toBe('2026-09-04 03:04:05.123456+00');
      expect(Object.keys(body.data).sort()).toEqual(['current', 'date', 'dayNumber', 'done', 'upcoming']);
      const select = mockFake.queries.find((q) => q.sql.includes('from "activities"'));
      expect(select?.sql).toContain('"updated_at"::text from "activities"');
      expect(select?.sql).toContain('order by "activities"."row_number"');
    });

    it('with nothing scheduled today, upcoming is the next open activity and current is null', async () => {
      jest.useFakeTimers({ now: new Date('2026-09-05T03:00:00Z'), doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
      const token = addToken(['schedule:read']);
      const { body } = await call(routes.today, '/today', token);
      expect(body.data.current).toBeNull();
      expect(body.data.done).toEqual([]);
      expect(body.data.upcoming.map((a: { id: string }) => a.id)).toEqual(['act-20']);
    });

    it('returns 500 database_error and no catalog data when the activities query throws (M9)', async () => {
      process.env.SHEETS_SCHEDULE_URL = 'https://proxy.invalid/schedule';
      process.env.GOOGLE_SHEETS_ID = 'sheet-id';
      const token = addToken(['schedule:read']);
      mockFake.failWith = (q) => (q.sql.includes('from "activities"') ? pgError('57P01') : undefined);
      const { status, body, text } = await call(routes.today, '/today', token);
      expect(status).toBe(500);
      expect(Object.keys(body).sort()).toEqual(['error', 'message', 'ok']);
      expectSubset(body, { ok: false, error: 'database_error' });
      for (const catalog of OFFICIAL_SCHEDULE_ACTIVITIES) {
        expect(text).not.toContain(catalog.id);
        expect(text).not.toContain(catalog.topic.split('\n')[0]);
      }
      expect(fetchCalls).toBe(0);
    });

    it('returns an empty view (not the catalog) when the activities table is empty', async () => {
      const token = addToken(['schedule:read']);
      mockFake.data = (q) => (q.sql.includes('from "activities"') ? [] : answer(q));
      const { status, body, text } = await call(routes.today, '/today', token);
      expect(status).toBe(200);
      expectSubset(body.data, { current: null, upcoming: [], done: [] });
      expect(text).not.toContain(OFFICIAL_SCHEDULE_ACTIVITIES[0].id);
    });
  });

  // -------------------------------------------------------------------------------------------
  // /schedule and /schedule/:id
  // -------------------------------------------------------------------------------------------

  describe('GET /schedule', () => {
    it('maps rows like the app does and keeps raw columns plus updatedAt', async () => {
      const token = addToken(['schedule:read']);
      const { body } = await call(routes.schedule, '/schedule', token);
      expect(body.data.activities).toHaveLength(ACTIVITY_ROWS.length);
      expectSubset(body.data.activities[0], {
        id: 'act-10',
        name: 'Welcome session',
        type: 'welcome',
        status: 'done',
        plannedStart: '09:00',
        actualStart: '09:05',
        durationMinutes: 45,
        rowNumber: 10,
        week: 'Week 1',
        progress: 'Done',
        mainMedia: 'Online Meeting',
        updatedAt: '2026-09-02 03:04:05.123456+00',
      });
    });

    it('filters by date, week and progress', async () => {
      const token = addToken(['schedule:read']);
      const ids = async (qs: string) =>
        ((await call(routes.schedule, `/schedule?${qs}`, token)).body.data.activities as Array<{ id: string }>).map((a) => a.id);
      expect(await ids('date=2026-09-02')).toEqual(['act-11', 'act-12', 'act-13']);
      expect(await ids('week=week%202')).toEqual(['act-20']);
      expect(await ids('progress=Done')).toEqual(['act-10', 'act-11']);
      expect(await ids('progress=Not%20Started')).toEqual(['act-13', 'act-14']);
      expect(await ids('date=2026-09-02&progress=In%20Progress')).toEqual(['act-12']);
    });

    const badScheduleQueries: Array<[string, string]> = [
      ['date=02/09/2026', 'date'],
      ['date=2026-02-30', 'date'],
      ['progress=Finished', 'progress'],
      ['progress=', 'progress'],
      ['week=', 'week'],
      ['date=2026-09-02&date=2026-09-03', 'only once'],
    ];
    for (const [qs, mentions] of badScheduleQueries) it(`returns 400 invalid_query for ${qs}`, async () => {
      const token = addToken(['schedule:read']);
      const { status, body } = await call(routes.schedule, `/schedule?${qs}`, token);
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_query');
      expect(JSON.stringify(body)).toContain(mentions);
    });
  });

  describe('GET /schedule/:id', () => {
    it('returns one activity', async () => {
      const token = addToken(['schedule:read']);
      const { body } = await call(routes.scheduleItem, '/schedule/act-13', token, { id: 'act-13' });
      expectSubset(body.data, { id: 'act-13', rowNumber: 13, progress: '', status: 'not-started' });
      const select = mockFake.queries.find((q) => q.sql.includes('from "activities"'));
      expect(select?.params[0]).toBe('act-13');
    });

    it('returns 404 not_found for an unknown id and 400 invalid_id for a malformed one', async () => {
      const token = addToken(['schedule:read']);
      const missing = await call(routes.scheduleItem, '/schedule/sched-row-999', token, { id: 'sched-row-999' });
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe('not_found');
      const malformed = await call(routes.scheduleItem, '/schedule/x', token, { id: 'bad id;' });
      expect(malformed.status).toBe(400);
      expect(malformed.body.error).toBe('invalid_id');
    });
  });

  // -------------------------------------------------------------------------------------------
  // /diary and /diary/:rowNumber
  // -------------------------------------------------------------------------------------------

  describe('GET /diary', () => {
    it('merges topics with entries; topic defaults when there is no entry', async () => {
      const token = addToken(['diary:read']);
      const { body } = await call(routes.diary, '/diary', token);
      expect(body.data.entries).toEqual([
        { rowNumber: 5, week: 'Week 1', day: 'Tuesday', date: '01/09/2026', activityCount: '1', pic: 'HR', topic: 'Orientation', learned: 'default learned', notes: 'default notes', hasEntry: false, updatedAt: null },
        { rowNumber: 6, week: 'Week 1', day: 'Wednesday', date: '02/09/2026', activityCount: '1', pic: 'IT', topic: 'Laptop', learned: 'Set up the VPN', notes: 'took long', hasEntry: true, updatedAt: '2026-09-02T05:00:00.000Z' },
      ]);
    });
  });

  describe('GET /diary/:rowNumber', () => {
    it('returns one merged row', async () => {
      const token = addToken(['diary:read']);
      const { body } = await call(routes.diaryItem, '/diary/6', token, { rowNumber: '6' });
      expectSubset(body.data, { rowNumber: 6, learned: 'Set up the VPN', hasEntry: true });
    });

    it('returns 404 for an unknown row and 400 invalid_id for a non-integer', async () => {
      const token = addToken(['diary:read']);
      const missing = await call(routes.diaryItem, '/diary/999', token, { rowNumber: '999' });
      expect(missing.status).toBe(404);
      expect(missing.body.error).toBe('not_found');
      for (const bad of ['abc', '0', '-1', '1e3', '06']) {
        const res = await call(routes.diaryItem, `/diary/${bad}`, token, { rowNumber: bad });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_id');
      }
    });
  });

  // -------------------------------------------------------------------------------------------
  // /feedback, /reviews, /timeline, /glossary
  // -------------------------------------------------------------------------------------------

  describe('GET /feedback', () => {
    it('uses the shared entry mapping and the canonical session ids when the table is empty', async () => {
      const token = addToken(['feedback:read']);
      const { body } = await call(routes.feedback, '/feedback', token);
      expect(body.data.sessionsSource).toBe('catalog');
      expect(body.data.sessions.map((s: { id: string }) => s.id)).toEqual(FEEDBACK_SESSIONS.map((s) => s.id));
      expect(body.data.entries).toEqual([
        {
          sessionId: 'row-3',
          sessionTitle: 'Introduction to Company',
          pic: 'Managing Director',
          date: '2026-09-02',
          ratings: FEEDBACK_ENTRIES[0].ratings,
          hasQuestions: true,
          questionExplanation: 'q',
          questionAddressing: 'Chat response is fine',
          suggestions: 's',
          createdAt: '2026-09-02T06:00:00.000Z',
          updatedAt: '2026-09-02T06:00:00.000Z',
          rowNumber: 3,
        },
      ]);
    });

    it('returns database sessions when present', async () => {
      feedbackSessionRows = [{ id: 'row-3', title: 'T', topic: 'Topic', pic: 'MD', rowNumber: 3, department: 'Exec', createdAt: '2026-09-01 00:00:00+00' }];
      const token = addToken(['feedback:read']);
      const { body } = await call(routes.feedback, '/feedback', token);
      expect(body.data.sessionsSource).toBe('database');
      expect(body.data.sessions).toEqual([{ id: 'row-3', title: 'T', topic: 'Topic', pic: 'MD', rowNumber: 3, department: 'Exec' }]);
    });
  });

  it('GET /reviews keeps numeric ratings only and exposes updatedAt', async () => {
    const token = addToken(['reviews:read']);
    const { body } = await call(routes.reviews, '/reviews', token);
    expect(body.data.reviews).toEqual([
      { month: 1, achievements: 'a', challenges: 'c', goalsNextMonth: 'g', technicalRatings: { t1: 80 }, valuesRatings: {}, updatedAt: '2026-10-01T00:00:00.000Z' },
    ]);
  });

  it('GET /timeline returns stages with string evidence and nullable updatedAt', async () => {
    const token = addToken(['timeline:read']);
    const { body } = await call(routes.timeline, '/timeline', token);
    expectSubset(body.data.stages[0], { id: 'stage-1', stageName: 'Orientation', completedEvidence: ['one'], updatedAt: null });
  });

  it('GET /glossary returns training modules from the database', async () => {
    const token = addToken(['glossary:read']);
    const { body } = await call(routes.glossary, '/glossary', token);
    expect(body.data.modules).toEqual([
      { id: 'mod-1', topic: 'Git', pic: 'IT', objectives: 'o', frameworkMaterials: 'f', materials: 'm', media: 'Video', durationMinutes: 30, materialLinks: [{ label: 'L', url: 'https://example.com', type: 'link' }] },
    ]);
  });

  // -------------------------------------------------------------------------------------------
  // /sessions
  // -------------------------------------------------------------------------------------------

  describe('GET /sessions', () => {
    it('returns ISO timestamps and filters in SQL by activityId and a Jakarta-day range', async () => {
      const token = addToken(['sessions:read']);
      const { body } = await call(routes.sessions, '/sessions?activityId=act-10&from=2026-09-01&to=2026-09-01', token);
      expect(body.data).toEqual({
        sessions: [
          {
            id: 's1',
            activityId: 'act-10',
            name: 'Welcome session',
            startedAt: '2026-09-01T02:00:00.000Z',
            finishedAt: '2026-09-01T02:45:00.000Z',
            durationMinutes: 45,
            createdAt: '2026-09-01T02:45:00.000Z',
          },
        ],
        truncated: false,
      });
      const select = mockFake.queries.find((q) => q.sql.includes('from "session_logs"'));
      expect(select?.sql).toContain('"session_logs"."activity_id" = $1');
      expect(select?.sql).toContain('"session_logs"."started_at" >= $2');
      expect(select?.sql).toContain('"session_logs"."started_at" < $3');
      // 2026-09-01 00:00 +07:00 .. 2026-09-02 00:00 +07:00
      expect(select?.params.slice(0, 3)).toEqual(['act-10', Date.UTC(2026, 7, 31, 17), Date.UTC(2026, 8, 1, 17)]);
    });

    it('accepts ISO datetimes with an offset', async () => {
      const token = addToken(['sessions:read']);
      const { status } = await call(routes.sessions, '/sessions?from=2026-09-01T00:00:00Z&to=2026-09-01T10:00:00%2B07:00', token);
      expect(status).toBe(200);
      const select = mockFake.queries.find((q) => q.sql.includes('from "session_logs"'));
      expect(select?.params.slice(0, 2)).toEqual([Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 1, 3) + 1]);
    });

    const badSessionQueries = [
      'from=yesterday',
      'to=2026-09-01T10:00:00',
      'from=2026-09-02&to=2026-09-01',
      'activityId=bad%20id',
      'limit=5',
    ];
    for (const qs of badSessionQueries) it(`returns 400 invalid_query for ${qs}`, async () => {
      const token = addToken(['sessions:read']);
      const { status, body } = await call(routes.sessions, `/sessions?${qs}`, token);
      expect(status).toBe(400);
      expect(body.error).toBe('invalid_query');
      expect(mockFake.queries.some((q) => q.sql.includes('from "session_logs"'))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------------------------
  // /me
  // -------------------------------------------------------------------------------------------

  describe('GET /me', () => {
    it('returns the token identity and limits equal to the env-derived config', async () => {
      process.env.AGENT_RATE_LIMIT_READS_PER_MIN = '42';
      process.env.AGENT_RATE_LIMIT_PROPOSALS_PER_MIN = '7';
      process.env.AGENT_MAX_PENDING_PROPOSALS = '3';
      const { getAgentConfig } = require('@/lib/agent/config') as typeof import('@/lib/agent/config');
      const config = getAgentConfig();
      const token = addToken(['diary:read', 'diary:propose']);
      const { body } = await call(routes.me, '/me', token);
      expect(body.data).toEqual({
        tokenName: 'openclaw laptop',
        scopes: ['diary:read', 'diary:propose'],
        expiresAt: '2027-01-01T00:00:00.000Z',
        limits: { readsPerMin: config.readsPerMin, proposalsPerMin: config.proposalsPerMin, maxPending: config.maxPending },
      });
      expect(body.data.limits).toEqual({ readsPerMin: 42, proposalsPerMin: 7, maxPending: 3 });
      expect(JSON.stringify(body)).not.toContain('nova_agt_');
    });
  });
});
