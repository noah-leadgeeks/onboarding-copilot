/**
 * Step 6: proposal creation, listing, reading and cancelling through the real routes, on the
 * in-memory fake (lib/agent/testing/fake-db.ts + fake-tables.ts). The SQL-level behaviour (NULL
 * `before`, microsecond `updated_at`) is covered by lib/agent/proposals.integration.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { findFeedbackSession, FEEDBACK_SESSIONS } from '@/lib/feedback';
import { createFakeAgentDb, type FakeAgentDb } from '@/lib/agent/testing/fake-db';
import type { FakeRow } from '@/lib/agent/testing/fake-tables';
import { generateAgentToken } from '@/lib/agent/tokens';
import { SCOPES } from '@/lib/agent/scopes';

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

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const proposalsRoute = require('./route') as { GET: Handler; POST: Handler };
const proposalRoute = require('./[id]/route') as { GET: Handler };
const cancelRoute = require('./[id]/cancel/route') as { POST: Handler };
const { DOMAINS } = require('@/lib/agent/domains') as typeof import('@/lib/agent/domains');

const ENV_KEYS = ['DATABASE_URL', 'AGENT_MAX_PENDING_PROPOSALS', 'AGENT_RATE_LIMIT_PROPOSALS_PER_MIN', 'AGENT_PROPOSAL_TTL_HOURS'] as const;
const FAKE_DB_URL = 'postgres://fake:fake@db.invalid:5432/fake';
const BASE = 'http://localhost/api/agent/v1';
const READ_SCOPES = SCOPES.filter((scope) => scope.endsWith(':read'));
const ALL_PROPOSE = SCOPES.filter((scope) => scope.endsWith(':propose'));

interface Body {
  ok: boolean;
  error?: string;
  status?: string;
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- response JSON is asserted structurally
}

let tokenSeq = 0;
function addToken(scopes: readonly string[]): { token: string; id: string } {
  const generated = generateAgentToken();
  tokenSeq += 1;
  const id = `tok_${tokenSeq}`;
  mockFake.tokens.push({
    id,
    name: 'openclaw',
    tokenPrefix: generated.prefix,
    tokenHash: generated.hash,
    scopes: [...scopes],
    expiresAt: null,
    revoked: false,
    expired: false,
  });
  return { token: generated.token, id };
}

async function send(handler: Handler, url: string, token: string, init: { method?: string; body?: unknown; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  }
  const res = await handler(new Request(`${BASE}${url}`, { method: init.method ?? 'GET', headers, body }), {
    params: Promise.resolve(init.params ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Body, text };
}

function propose(token: string, body: unknown) {
  return send(proposalsRoute.POST, '/proposals', token, { method: 'POST', body });
}

let keySeq = 0;
function key(): string {
  keySeq += 1;
  return `idem-key-${keySeq}-${Date.now()}`;
}

function diaryBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    domain: 'diary',
    operation: 'update',
    target: { rowNumber: 6 },
    changes: { learned: 'learned more' },
    reason: 'user asked',
    idempotencyKey: key(),
    ...overrides,
  };
}

function seedTables(): void {
  mockFake.tables.activities = [
    {
      id: 'sched-row-10',
      row_number: 10,
      progress: '',
      start_time: '09:00',
      end_time: '10:00',
      duration_minutes: null,
      notes: 'old notes',
      materials_link: '',
      actual_start: '09:05',
      updated_at: '2026-09-01 03:04:05.123456+00',
    },
  ];
  mockFake.tables.diary_topics = [
    { id: 'topic-5', row_number: 5, default_learned: 'default learned', default_notes: 'default notes' },
    { id: 'topic-6', row_number: 6, default_learned: null, default_notes: null },
  ];
  mockFake.tables.diary_entries = [{ id: 'entry-6', row_number: 6, learned: 'old learned', notes: 'old notes', updated_at: '2026-09-02T05:00:00.000Z' }];
  mockFake.tables.feedback_sessions = [];
  mockFake.tables.feedback_entries = [
    {
      id: 'fb-row-3',
      session_id: 'row-3',
      row_number: 3,
      date: '2026-09-02',
      pic: 'Managing Director',
      topic: 'Introduction to Company',
      ratings: { communication: 6, alignment: 5, understanding: 5, readiness: 4, pace: 5, overall: 5 },
      has_questions: false,
      question_explanation: '',
      question_addressing: '',
      suggestions: 'old',
      updated_at: '2026-09-02T06:00:00.000Z',
    },
  ];
  mockFake.tables.monthly_reviews = [
    { id: 'month-1', month: 1, achievements: 'a', challenges: 'c', goals_next_month: 'g', technical_ratings: null, values_ratings: null, updated_at: '2026-10-01T00:00:00.000Z' },
  ];
  mockFake.tables.timeline_stages = [
    { id: 'stage-1', start_date: '01/09/2026', end_date: '30/09/2026', completed_evidence: ['one'], updated_at: null },
  ];
}

function seedProposal(tokenId: string, overrides: Partial<FakeRow> = {}): FakeRow {
  const row: FakeRow = {
    id: `prp_seed_${Math.random().toString(36).slice(2)}`,
    token_id: tokenId,
    domain: 'diary',
    operation: 'update',
    target_table: 'diary_entries',
    target_key: '{"rowNumber":6}',
    changes: '{"learned":"x"}',
    before: null,
    expected_updated_at: null,
    ratings_source: null,
    warnings: '[]',
    reason: 'seed',
    idempotency_key: `seed-${Math.random().toString(36).slice(2)}`,
    body_hash: 'seed',
    status: 'pending',
    created_at: '2026-10-01T00:00:00.000Z',
    expires_at: '2026-10-02T00:00:00.000Z',
    decided_at: null,
    executed_at: null,
    result: null,
    __expired: false,
    __seq: 0,
    ...overrides,
  };
  mockFake.tables.agent_proposals.push(row);
  return row;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /[\\/]route\.ts$/.test(full) ? [full] : [];
  });
}

describe('/api/agent/v1/proposals', () => {
  const savedEnv = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const k of ENV_KEYS) savedEnv.set(k, process.env[k]);
  });

  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.DATABASE_URL = FAKE_DB_URL;
    process.env.AGENT_RATE_LIMIT_PROPOSALS_PER_MIN = '1000';
    mockFake = createFakeAgentDb();
    seedTables();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    for (const [k, value] of savedEnv) {
      if (value === undefined) delete process.env[k];
      else process.env[k] = value;
    }
  });

  // -------------------------------------------------------------------------------------------
  // 422 validation
  // -------------------------------------------------------------------------------------------

  describe('422 invalid_proposal', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['unknown domain', { domain: 'glossary' }],
      ['unknown body field', { extra: 1 }],
      ['unknown operation', { operation: 'upsert' }],
      ['operation not offered by the domain (schedule delete)', { domain: 'schedule', target: { id: 'sched-row-10' }, changes: undefined, operation: 'delete' }],
      ['unknown field', { changes: { learned: 'x', mood: 'happy' } }],
      ['non-proposable schedule column', { domain: 'schedule', target: { id: 'sched-row-10' }, changes: { actualStart: '09:00' } }],
      ['bad URL (http)', { domain: 'schedule', target: { id: 'sched-row-10' }, changes: { materialsLink: 'http://example.com/doc' } }],
      ['bad URL (javascript:)', { domain: 'schedule', target: { id: 'sched-row-10' }, changes: { materialsLink: 'javascript:alert(1)' } }],
      ['bad URL (relative)', { domain: 'schedule', target: { id: 'sched-row-10' }, changes: { materialsLink: '/docs/x' } }],
      ['bad key charset', { idempotencyKey: 'has spaces and !' }],
      ['short key', { idempotencyKey: 'short' }],
      ['bad target key charset', { domain: 'schedule', target: { id: 'sched row 10' }, changes: { notes: 'x' } }],
      ['unknown target key', { target: { rowNumber: 6, extra: 1 } }],
      ['empty changes', { changes: {} }],
      ['changes on delete', { operation: 'delete', changes: { learned: 'x' } }],
      ['empty reason', { reason: '   ' }],
      ['reason too long', { reason: 'x'.repeat(2001) }],
      ['text too long', { changes: { notes: 'x'.repeat(10_001) } }],
      ['bad progress', { domain: 'schedule', target: { id: 'sched-row-10' }, changes: { progress: 'Finished' } }],
      ['bad clock', { domain: 'schedule', target: { id: 'sched-row-10' }, changes: { startTime: '9am' } }],
      ['bad ratingsSource', { ratingsSource: 'agent-guess' }],
    ];
    for (const [name, overrides] of cases) {
      it(name, async () => {
        const { token } = addToken(ALL_PROPOSE);
        const { status, body } = await propose(token, diaryBody(overrides));
        expect(status).toBe(422);
        expect(body.error).toBe('invalid_proposal');
        expect(mockFake.tables.agent_proposals).toHaveLength(0);
      });
    }

    it('non-JSON body', async () => {
      const { token } = addToken(ALL_PROPOSE);
      const { status, body } = await propose(token, '{not json');
      expect(status).toBe(422);
      expect(body.error).toBe('invalid_proposal');
    });

    it('ratings without ratingsSource (feedback and reviews)', async () => {
      const { token } = addToken(ALL_PROPOSE);
      const ratings = { communication: 6, alignment: 5, understanding: 5, readiness: 4, pace: 5, overall: 5 };
      const feedback = await propose(token, { ...diaryBody(), domain: 'feedback', target: { sessionId: 'row-3' }, changes: { ratings } });
      expect(feedback.status).toBe(422);
      expect(feedback.body.error).toBe('invalid_proposal');
      const reviews = await propose(token, { ...diaryBody(), domain: 'reviews', target: { month: 1 }, changes: { valuesRatings: {} } });
      expect(reviews.status).toBe(422);
      const ok = await propose(token, {
        ...diaryBody(),
        domain: 'feedback',
        target: { sessionId: 'row-3' },
        changes: { ratings },
        ratingsSource: 'user-dictated',
      });
      expect(ok.status).toBe(202);
      expect(ok.body.data.ratingsSource).toBe('user-dictated');
    });
  });

  // -------------------------------------------------------------------------------------------
  // 404 targets
  // -------------------------------------------------------------------------------------------

  it('404 for a missing target (diary topic, schedule activity, timeline stage)', async () => {
    const { token } = addToken(ALL_PROPOSE);
    const missing = [
      diaryBody({ target: { rowNumber: 999 } }),
      diaryBody({ domain: 'schedule', target: { id: 'sched-row-999' }, changes: { notes: 'x' } }),
      diaryBody({ domain: 'timeline', target: { stageId: 'stage-9' }, changes: { startDate: '01/10/2026' } }),
      diaryBody({ domain: 'feedback', target: { sessionId: 'row-999' }, changes: { suggestions: 'x' } }),
    ];
    for (const body of missing) {
      const res = await propose(token, body);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('not_found');
    }
    expect(mockFake.tables.agent_proposals).toHaveLength(0);
  });

  it('404 for a delete of an absent diary / feedback / review row', async () => {
    const { token } = addToken(ALL_PROPOSE);
    const absent = [
      { domain: 'diary', target: { rowNumber: 5 } },
      { domain: 'feedback', target: { sessionId: 'row-4' } },
      { domain: 'reviews', target: { month: 2 } },
    ];
    for (const item of absent) {
      const res = await propose(token, { ...diaryBody(), ...item, operation: 'delete', changes: undefined });
      expect(res.status).toBe(404);
    }
    expect(mockFake.tables.agent_proposals).toHaveLength(0);
    const present = await propose(token, { ...diaryBody(), operation: 'delete', changes: {} });
    expect(present.status).toBe(202);
    expect(present.body.data.before).toEqual({ learned: 'old learned', notes: 'old notes' });
  });

  // -------------------------------------------------------------------------------------------
  // Scopes (S4)
  // -------------------------------------------------------------------------------------------

  it('403 when the token has diary:propose but proposes schedule', async () => {
    const { token } = addToken(['diary:propose']);
    const res = await propose(token, diaryBody({ domain: 'schedule', target: { id: 'sched-row-10' }, changes: { notes: 'x' } }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
    expect(mockFake.tables.agent_proposals).toHaveLength(0);
    const own = await propose(token, diaryBody());
    expect(own.status).toBe(202);
  });

  it('exhaustive: a token with only *:read scopes gets 403 on every POST under /api/agent/v1', async () => {
    const root = path.join(process.cwd(), 'app', 'api', 'agent', 'v1');
    const modules = walk(root)
      .map((file) => ({ file, mod: require(file) as Record<string, unknown> }))
      .filter(({ mod }) => typeof mod.POST === 'function');
    const relative = modules.map(({ file }) => path.relative(root, file).split(path.sep).join('/')).sort();
    expect(relative).toEqual(['proposals/[id]/cancel/route.ts', 'proposals/route.ts']);

    const { token, id } = addToken(READ_SCOPES);
    const seeded = seedProposal(id);
    for (const { mod } of modules) {
      const res = await send(mod.POST as Handler, '/proposals', token, {
        method: 'POST',
        body: diaryBody(),
        params: { id: String(seeded.id) },
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('insufficient_scope');
    }
    expect(mockFake.tables.agent_proposals).toHaveLength(1);
    expect(seeded.status).toBe('pending');
  });

  // -------------------------------------------------------------------------------------------
  // Creation, idempotency, cap
  // -------------------------------------------------------------------------------------------

  it('202 with before limited to the touched keys, stored as pending with the snapshot updated_at', async () => {
    const { token, id } = addToken(['schedule:propose']);
    const res = await propose(token, diaryBody({ domain: 'schedule', target: { id: 'sched-row-10' }, changes: { notes: 'new notes', progress: 'Done' } }));
    expect(res.status).toBe(202);
    const data = res.body.data;
    expect(data.status).toBe('pending');
    expect(data.before).toEqual({ notes: 'old notes', progress: '' });
    expect(data.changes).toEqual({ notes: 'new notes', progress: 'Done' });
    expect(data.target).toEqual({ id: 'sched-row-10' });
    expect(data.expectedUpdatedAt).toBe('2026-09-01 03:04:05.123456+00');
    expect(data.warnings).toEqual([]);
    expect(Object.keys(data)).not.toContain('bodyHash');
    expect(Object.keys(data)).not.toContain('tokenId');

    const stored = mockFake.tables.agent_proposals[0];
    expect(stored.token_id).toBe(id);
    expect(stored.target_table).toBe('activities');
    const lock = mockFake.queries.find((q) => q.sql.includes('from "agent_tokens"') && q.sql.endsWith(' for share'));
    expect(lock?.params).toEqual([id]);

    const audit = mockFake.audit.find((row) => row.proposal_id === data.id);
    expect(audit?.action).toBe('propose.schedule.update');
    expect(audit?.status_code).toBe(202);
    expect(JSON.stringify(audit)).not.toContain('new notes');
  });

  it('formula-like text -> 202 with warnings', async () => {
    const { token } = addToken(['diary:propose']);
    const res = await propose(token, diaryBody({ changes: { learned: '  =HYPERLINK("x")', notes: '\tplain' } }));
    expect(res.status).toBe(202);
    expect(res.body.data.warnings).toEqual(['formula_like:learned', 'formula_like:notes']);
  });

  it('replays the same key + body -> 200 with the same id, even when the pending cap is reached', async () => {
    process.env.AGENT_MAX_PENDING_PROPOSALS = '1';
    const { token } = addToken(['diary:propose']);
    const body = diaryBody();
    const first = await propose(token, body);
    expect(first.status).toBe(202);
    const blocked = await propose(token, diaryBody());
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('too_many_pending');
    const replay = await propose(token, { ...body, changes: { learned: 'learned more' } });
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(mockFake.tables.agent_proposals).toHaveLength(1);
  });

  it('same key with a different body -> 422 idempotency_key_reused', async () => {
    const { token } = addToken(['diary:propose']);
    const body = diaryBody();
    expect((await propose(token, body)).status).toBe(202);
    const reused = await propose(token, { ...body, reason: 'another reason' });
    expect(reused.status).toBe(422);
    expect(reused.body.error).toBe('idempotency_key_reused');
  });

  it('the same key on another token is independent', async () => {
    const a = addToken(['diary:propose']);
    const b = addToken(['diary:propose']);
    const body = diaryBody();
    expect((await propose(a.token, body)).status).toBe(202);
    expect((await propose(b.token, { ...body, reason: 'different' })).status).toBe(202);
  });

  it('the pending cap counts only unexpired pending proposals of this token', async () => {
    process.env.AGENT_MAX_PENDING_PROPOSALS = '1';
    const { token, id } = addToken(['diary:propose']);
    const other = addToken(['diary:propose']);
    seedProposal(id, { status: 'pending', __expired: true });
    seedProposal(id, { status: 'executed' });
    seedProposal(id, { status: 'cancelled' });
    seedProposal(other.id, { status: 'pending' });
    const res = await propose(token, diaryBody());
    expect(res.status).toBe(202);
    const next = await propose(token, diaryBody());
    expect(next.status).toBe(429);
    const countQuery = mockFake.queries.find((q) => q.sql.startsWith('select count(*)::int from "agent_proposals"'));
    expect(countQuery?.sql).toContain('"agent_proposals"."expires_at" > now()');
  });

  it('a token revoked inside the transaction -> 401 and no insert', async () => {
    const created = addToken(['diary:propose']);
    mockFake.failWith = (query) => {
      if (query.sql.includes('from "agent_tokens"') && query.sql.endsWith(' for share')) {
        const token = mockFake.tokens.find((t) => t.id === created.id);
        if (token) token.revoked = true;
      }
      return undefined;
    };
    const res = await propose(created.token, diaryBody());
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
    expect(mockFake.tables.agent_proposals).toHaveLength(0);
    expect(mockFake.queries.some((q) => q.sql.startsWith('insert into "agent_proposals"'))).toBe(false);
  });

  it('a body over 64 KiB is rejected', async () => {
    const { token } = addToken(['diary:propose']);
    const res = await propose(token, JSON.stringify({ ...diaryBody(), pad: 'x'.repeat(70_000) }));
    expect(res.status).toBe(422);
  });

  // -------------------------------------------------------------------------------------------
  // Feedback exact-id resolution (M8)
  // -------------------------------------------------------------------------------------------

  it('feedback sessionId that only fuzzy-matches -> 404; exact id -> 202 with the canonical id', async () => {
    const { token } = addToken(['feedback:propose']);
    const fuzzy = ['Introduction to Company', 'ROW-3', 'row 3', 'row-3 '];
    for (const sessionId of fuzzy) {
      expect(findFeedbackSession(sessionId)?.id).toBe('row-3');
      const res = await propose(token, diaryBody({ domain: 'feedback', target: { sessionId }, changes: { suggestions: 'x' } }));
      expect(res.status).toBe(404);
    }
    const exact = await propose(token, diaryBody({ domain: 'feedback', target: { sessionId: 'row-3' }, changes: { suggestions: 'new' } }));
    expect(exact.status).toBe(202);
    expect(exact.body.data.target).toEqual({ sessionId: 'row-3' });
    expect(exact.body.data.before).toEqual({ suggestions: 'old' });
    expect(mockFake.tables.agent_proposals[0].target_key).toBe('{"sessionId":"row-3"}');
  });

  it('feedback target may be a feedback_sessions row id', async () => {
    mockFake.tables.feedback_sessions = [{ id: 'custom-session', row_number: 40, pic: 'Lead', topic: 'Custom' }];
    const { token } = addToken(['feedback:propose']);
    const res = await propose(token, diaryBody({ domain: 'feedback', target: { sessionId: 'custom-session' }, changes: { hasQuestions: true } }));
    expect(res.status).toBe(202);
    expect(res.body.data.before).toBeNull();
    expect(res.body.data.expectedUpdatedAt).toBeNull();
  });

  // -------------------------------------------------------------------------------------------
  // GET list / item, cancel
  // -------------------------------------------------------------------------------------------

  it('GET /proposals lists only own proposals, filters by status and marks expired ones lazily', async () => {
    const mine = addToken(['diary:propose']);
    const other = addToken(['diary:propose']);
    const expired = seedProposal(mine.id, { __expired: true });
    seedProposal(mine.id, { status: 'executed' });
    seedProposal(other.id);
    const all = await send(proposalsRoute.GET, '/proposals', mine.token);
    expect(all.status).toBe(200);
    expect(all.body.data.proposals).toHaveLength(2);
    expect(expired.status).toBe('expired');
    const executed = await send(proposalsRoute.GET, '/proposals?status=executed', mine.token);
    expect(executed.body.data.proposals.map((p: { status: string }) => p.status)).toEqual(['executed']);
    const bad = await send(proposalsRoute.GET, '/proposals?status=done', mine.token);
    expect(bad.status).toBe(400);
    const readOnly = addToken(['diary:read']);
    expect((await send(proposalsRoute.GET, '/proposals', readOnly.token)).status).toBe(403);
  });

  it('GET /proposals/:id returns own proposals only', async () => {
    const mine = addToken(['diary:propose']);
    const other = addToken(['diary:propose']);
    const created = await propose(mine.token, diaryBody());
    const proposalId = created.body.data.id as string;
    const own = await send(proposalRoute.GET, `/proposals/${proposalId}`, mine.token, { params: { id: proposalId } });
    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(proposalId);
    expect(own.body.data.before).toEqual({ learned: 'old learned' });
    const foreign = await send(proposalRoute.GET, `/proposals/${proposalId}`, other.token, { params: { id: proposalId } });
    expect(foreign.status).toBe(404);
    const expiredRow = seedProposal(mine.id, { __expired: true });
    const expired = await send(proposalRoute.GET, `/proposals/${expiredRow.id}`, mine.token, { params: { id: String(expiredRow.id) } });
    expect(expired.body.data.status).toBe('expired');
  });

  it('cancel: own pending -> 200 cancelled (locked FOR NO KEY UPDATE); again -> 409; other token -> 404; expired -> 409 expired', async () => {
    const mine = addToken(['diary:propose']);
    const other = addToken(['schedule:propose']);
    const created = await propose(mine.token, diaryBody());
    const proposalId = created.body.data.id as string;
    const cancel = (token: string, id: string) =>
      send(cancelRoute.POST, `/proposals/${id}/cancel`, token, { method: 'POST', params: { id } });

    expect((await cancel(other.token, proposalId)).status).toBe(404);
    const first = await cancel(mine.token, proposalId);
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('cancelled');
    const lock = mockFake.queries.find((q) => q.sql.startsWith('select') && q.sql.endsWith(' for no key update'));
    expect(lock?.sql).toContain('from "agent_proposals"');
    const again = await cancel(mine.token, proposalId);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('proposal_not_pending');
    expect(again.body.status).toBe('cancelled');

    const expiredRow = seedProposal(mine.id, { __expired: true });
    const expired = await cancel(mine.token, String(expiredRow.id));
    expect(expired.status).toBe(409);
    expect(expired.body.status).toBe('expired');
    expect(expiredRow.status).toBe('expired');

    const audit = mockFake.audit.filter((row) => row.action === 'cancel');
    expect(audit.map((row) => row.status_code)).toEqual([404, 200, 409, 409]);
  });

  it('no FOR UPDATE lock is ever taken on agent_tokens', async () => {
    const { token } = addToken(['diary:propose']);
    const created = await propose(token, diaryBody());
    await send(cancelRoute.POST, '/x', token, { method: 'POST', params: { id: created.body.data.id } });
    const tokenLocks = mockFake.queries.filter((q) => q.sql.includes('from "agent_tokens"') && / for (update|no key update)$/.test(q.sql));
    expect(tokenLocks).toHaveLength(0);
  });

  // -------------------------------------------------------------------------------------------
  // apply (executed in Step 7; minimal unit coverage here)
  // -------------------------------------------------------------------------------------------

  describe('apply', () => {
    type Tx = Parameters<(typeof DOMAINS)['diary']['apply']>[0];
    const tx = () => mockFake.db as unknown as Tx;

    it('feedback: a new row takes rowNumber/pic/topic from the exact-matched session', async () => {
      const session = FEEDBACK_SESSIONS.find((s) => s.id === 'row-4');
      const result = await DOMAINS.feedback.apply(tx(), { sessionId: 'row-4' }, { suggestions: 'more demos' });
      expect(result).toEqual({ applied: true, after: { suggestions: 'more demos' } });
      const row = mockFake.tables.feedback_entries.find((r) => r.session_id === 'row-4');
      expect(row?.id).toBe('fb-row-4');
      expect(row?.row_number).toBe(session?.rowNumber);
      expect(row?.pic).toBe(session?.pic);
      expect(row?.topic).toBe(session?.topic ?? session?.title);
      expect(typeof row?.updated_at).toBe('string');
    });

    it('feedback: an existing row is updated in place (unlisted fields untouched)', async () => {
      const result = await DOMAINS.feedback.apply(tx(), { sessionId: 'row-3' }, { hasQuestions: true });
      expect(result).toEqual({ applied: true, after: { hasQuestions: true } });
      const row = mockFake.tables.feedback_entries.find((r) => r.session_id === 'row-3');
      expect(row?.suggestions).toBe('old');
      expect(row?.updated_at).not.toBe('2026-09-02T06:00:00.000Z');
    });

    it('schedule: bumps updated_at with now() and reports a missing row', async () => {
      const result = await DOMAINS.schedule.apply(tx(), { id: 'sched-row-10' }, { notes: 'n' });
      expect(result).toEqual({ applied: true, after: { notes: 'n' } });
      const update = mockFake.queries.find((q) => q.sql.startsWith('update "activities"'));
      expect(update?.sql).toContain('"updated_at" = now()');
      expect(mockFake.tables.activities[0].actual_start).toBe('09:05');
      expect(await DOMAINS.schedule.apply(tx(), { id: 'sched-row-99' }, { notes: 'n' })).toEqual({ applied: false, reason: 'target_missing' });
      await expect_throws(() => DOMAINS.schedule.apply(tx(), { id: 'sched-row-10' }, 'delete'));
    });

    it('diary: insert uses topic defaults for unlisted fields; insert conflict is reported', async () => {
      const result = await DOMAINS.diary.apply(tx(), { rowNumber: 5 }, { notes: 'mine' });
      expect(result).toEqual({ applied: true, after: { notes: 'mine' } });
      const row = mockFake.tables.diary_entries.find((r) => r.row_number === 5);
      expect(row?.learned).toBe('default learned');
      expect(row?.id).toBe('entry-5');
      expect(await DOMAINS.diary.apply(tx(), { rowNumber: 5 }, 'delete')).toEqual({ applied: true, after: null });
      expect(await DOMAINS.diary.apply(tx(), { rowNumber: 5 }, 'delete')).toEqual({ applied: false, reason: 'target_missing' });
    });

    it('timeline: replaces completedEvidence', async () => {
      const result = await DOMAINS.timeline.apply(tx(), { stageId: 'stage-1' }, { completedEvidence: ['a', 'b'] });
      expect(result).toEqual({ applied: true, after: { completedEvidence: ['a', 'b'] } });
    });
  });
});

async function expect_throws(fn: () => Promise<unknown>): Promise<void> {
  let thrown = false;
  try {
    await fn();
  } catch {
    thrown = true;
  }
  expect(thrown).toBe(true);
}
