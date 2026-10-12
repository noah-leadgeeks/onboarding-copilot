/**
 * Step 7: owner approval and rejection through the admin routes, on the in-memory fake
 * (lib/agent/testing/fake-db.ts + fake-tables.ts; `db.transaction` rolls back the fake tables on
 * throw). Real locking, microsecond precision and races are covered by approvals.integration.test.ts.
 */
import { serializeSessionCookie } from '@/lib/auth/session';
import { createFakeAgentDb, pgError, type FakeAgentDb } from '@/lib/agent/testing/fake-db';
import type { FakeRow } from '@/lib/agent/testing/fake-tables';
import { generateAgentToken } from '@/lib/agent/tokens';

// jest.mock is not hoisted by this repo's transform, so it runs before the modules are required below.
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
const approveRoute = require('@/app/api/agent-admin/proposals/[id]/approve/route') as { POST: Handler };
const rejectRoute = require('@/app/api/agent-admin/proposals/[id]/reject/route') as { POST: Handler };
const listRoute = require('@/app/api/agent-admin/proposals/route') as { GET: Handler };
const { createProposal } = require('./proposals') as typeof import('./proposals');
const { failureMessage, MAX_FAILURE_MESSAGE_LENGTH } = require('./approvals') as typeof import('./approvals');

const ENV_KEYS = ['DATABASE_URL', 'AUTH_SECRET', 'GOOGLE_CLIENT_SECRET', 'AGENT_ADMIN_EMAILS', 'AUTH_DISABLED', 'VERCEL'] as const;
const OWNER = 'owner@example.com';
const BASE = 'http://localhost/api/agent-admin/proposals';
const DIARY_TS = '2026-09-01T00:00:00.000Z';
const ACTIVITY_TS = '2026-09-01 03:04:05.123456+00';

interface Body {
  ok: boolean;
  error?: string;
  status?: string;
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- response JSON is asserted structurally
  proposal?: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- response JSON is asserted structurally
}

let saved: Record<string, string | undefined> = {};
let cookie = '';
let tokenId = '';
let idemSeq = 0;

function ownerCookie(email = OWNER): string {
  return serializeSessionCookie({
    user: { id: 'u1', email, name: 'Owner' },
    tokens: { accessToken: 'a', expiresAt: Date.now() + 3_600_000, scope: '' },
    createdAt: new Date().toISOString(),
  });
}

function adminRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `nova_session=${cookie}`, ...headers },
    body: JSON.stringify(body),
  });
}

async function call(handler: Handler, request: Request, id: string): Promise<{ status: number; body: Body; cache: string | null }> {
  const response = await handler(request, { params: Promise.resolve({ id }) });
  return { status: response.status, body: (await response.json()) as Body, cache: response.headers.get('cache-control') };
}

function approve(id: string, body: Record<string, unknown>) {
  return call(approveRoute.POST, adminRequest(`${BASE}/${id}/approve`, body), id);
}

function reject(id: string, body: Record<string, unknown> = {}) {
  return call(rejectRoute.POST, adminRequest(`${BASE}/${id}/reject`, body), id);
}

function proposalRow(id: string): FakeRow {
  const row = mockFake.tables.agent_proposals.find((r) => r.id === id);
  if (!row) throw new Error(`no proposal ${id}`);
  return row;
}

function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function diaryRow(): FakeRow {
  return mockFake.tables.diary_entries[0];
}

function activityRow(): FakeRow {
  return mockFake.tables.activities[0];
}

function seed(): void {
  mockFake.tables.diary_topics = [
    { id: 'topic-14', row_number: 14, default_learned: 'default learned', default_notes: 'default notes' },
  ];
  mockFake.tables.diary_entries = [{ id: 'entry-14', row_number: 14, learned: 'old learned', notes: 'keep notes', updated_at: DIARY_TS }];
  mockFake.tables.activities = [
    {
      id: 'sched-row-5',
      row_number: 5,
      progress: 'In Progress',
      start_time: '09:00',
      end_time: '10:00',
      duration_minutes: 60,
      notes: 'old notes',
      materials_link: 'https://example.com/m',
      actual_start: '09:01',
      updated_at: ACTIVITY_TS,
    },
  ];
  mockFake.tables.timeline_stages = [
    { id: 'stage-1', start_date: '01/09/2026', end_date: '30/09/2026', completed_evidence: '["a"]', updated_at: DIARY_TS },
  ];
  mockFake.tables.feedback_sessions = [];
  mockFake.tables.feedback_entries = [
    { id: 'fb-row-3', session_id: 'row-3', row_number: 3, suggestions: 'old', has_questions: false, updated_at: DIARY_TS },
  ];
  mockFake.tables.monthly_reviews = [{ id: 'month-1', month: 1, achievements: 'old', challenges: 'c', updated_at: DIARY_TS }];
}

async function propose(body: Record<string, unknown>): Promise<{ id: string; expectedUpdatedAt: string | null }> {
  idemSeq += 1;
  const result = await createProposal(
    { tokenId, scopes: ['diary:propose', 'schedule:propose', 'timeline:propose', 'feedback:propose', 'reviews:propose'] },
    { reason: 'test', idempotencyKey: `idem-approve-${idemSeq}`, ...body }
  );
  if (!result.outcome.ok) throw new Error(`proposal failed: ${result.outcome.error} ${result.outcome.message}`);
  return { id: result.outcome.proposal.id, expectedUpdatedAt: result.outcome.proposal.expectedUpdatedAt };
}

function proposeDiary(changes: Record<string, unknown> = { learned: 'new learned' }) {
  return propose({ domain: 'diary', operation: 'update', target: { rowNumber: 14 }, changes });
}

function writes(table: string): string[] {
  return mockFake.queries.map((q) => q.sql).filter((s) => s.startsWith(`update "${table}"`) || s.startsWith(`delete from "${table}"`) || s.startsWith(`insert into "${table}"`));
}

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.DATABASE_URL = 'postgres://fake:fake@db.invalid:5432/fake';
  process.env.AUTH_SECRET = 'approvals-test-secret';
  delete process.env.GOOGLE_CLIENT_SECRET;
  process.env.AGENT_ADMIN_EMAILS = OWNER;
  delete process.env.AUTH_DISABLED;
  delete process.env.VERCEL;
  mockFake = createFakeAgentDb();
  const generated = generateAgentToken();
  tokenId = 'tok_owner_test';
  mockFake.tokens.push({
    id: tokenId,
    name: 'openclaw',
    tokenPrefix: generated.prefix,
    tokenHash: generated.hash,
    scopes: ['diary:propose'],
    expiresAt: null,
    revoked: false,
    expired: false,
  });
  seed();
  cookie = ownerCookie();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  jest.restoreAllMocks();
});

describe('approve: pending happy path', () => {
  it('executes a diary update: only listed fields change, updated_at is bumped (S9, M2), audit row 200', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary();
    expect(expectedUpdatedAt).toBe(DIARY_TS);
    const res = await approve(id, { expectedUpdatedAt });
    expect(res.status).toBe(200);
    expect(res.cache).toBe('no-store');
    expect(res.body.ok).toBe(true);
    expect(res.body.data.status).toBe('executed');
    expect(res.body.data.after).toEqual({ learned: 'new learned' });
    expect(diaryRow().learned).toBe('new learned');
    expect(diaryRow().notes).toBe('keep notes');
    expect(diaryRow().updated_at).not.toBe(DIARY_TS);
    const row = proposalRow(id);
    expect(row.status).toBe('executed');
    expect(row.decided_by).toBe(OWNER);
    expect(Boolean(row.executed_at)).toBe(true);
    expect(json(row.result)).toEqual({ learned: 'new learned' });
    const audit = mockFake.audit.filter((a) => a.action === 'approve');
    expect(audit.map((a) => [a.actor, a.status_code, a.proposal_id, a.user_email])).toEqual([['user', 200, id, OWNER]]);
  });

  it('schedule update leaves unlisted columns untouched and sets updated_at = now() (S9, M2)', async () => {
    const { id, expectedUpdatedAt } = await propose({
      domain: 'schedule',
      operation: 'update',
      target: { id: 'sched-row-5' },
      changes: { notes: 'agent notes' },
    });
    expect(expectedUpdatedAt).toBe(ACTIVITY_TS);
    const res = await approve(id, { expectedUpdatedAt });
    expect(res.status).toBe(200);
    const after = activityRow();
    expect(after.notes).toBe('agent notes');
    expect([after.progress, after.start_time, after.end_time, after.duration_minutes, after.materials_link, after.actual_start]).toEqual([
      'In Progress',
      '09:00',
      '10:00',
      60,
      'https://example.com/m',
      '09:01',
    ]);
    expect(after.updated_at).not.toBe(ACTIVITY_TS);
    expect(writes('activities').some((s) => s.includes('"updated_at" = now()'))).toBe(true);
  });

  it('every domain bumps updated_at on apply (M2)', async () => {
    const cases: Array<{ body: Record<string, unknown>; table: string; find: (r: FakeRow) => boolean }> = [
      { body: { domain: 'diary', operation: 'update', target: { rowNumber: 14 }, changes: { notes: 'n' } }, table: 'diary_entries', find: (r) => r.row_number === 14 },
      { body: { domain: 'schedule', operation: 'update', target: { id: 'sched-row-5' }, changes: { progress: 'Done' } }, table: 'activities', find: (r) => r.id === 'sched-row-5' },
      { body: { domain: 'timeline', operation: 'update', target: { stageId: 'stage-1' }, changes: { completedEvidence: ['b'] } }, table: 'timeline_stages', find: (r) => r.id === 'stage-1' },
      { body: { domain: 'feedback', operation: 'update', target: { sessionId: 'row-3' }, changes: { suggestions: 's' } }, table: 'feedback_entries', find: (r) => r.session_id === 'row-3' },
      { body: { domain: 'reviews', operation: 'update', target: { month: 1 }, changes: { achievements: 'a' } }, table: 'monthly_reviews', find: (r) => r.month === 1 },
    ];
    for (const c of cases) {
      const before = mockFake.tables[c.table].find(c.find)?.updated_at;
      const { id, expectedUpdatedAt } = await propose(c.body);
      const res = await approve(id, { expectedUpdatedAt });
      expect([c.table, res.status]).toEqual([c.table, 200]);
      const now = mockFake.tables[c.table].find(c.find)?.updated_at;
      expect(typeof now).toBe('string');
      expect([c.table, now === before]).toEqual([c.table, false]);
    }
  });

  it('an update for an absent diary entry (before null) inserts it on the first approve', async () => {
    mockFake.tables.diary_entries = [];
    const { id, expectedUpdatedAt } = await proposeDiary({ learned: 'fresh' });
    expect(expectedUpdatedAt).toBeNull();
    const res = await approve(id, { expectedUpdatedAt: null });
    expect(res.status).toBe(200);
    expect([diaryRow().learned, diaryRow().notes]).toEqual(['fresh', 'default notes']);
  });

  it('a diary delete removes the entry row', async () => {
    const { id, expectedUpdatedAt } = await propose({ domain: 'diary', operation: 'delete', target: { rowNumber: 14 } });
    const res = await approve(id, { expectedUpdatedAt });
    expect(res.status).toBe(200);
    expect(res.body.data.after).toBeNull();
    expect(mockFake.tables.diary_entries).toHaveLength(0);
  });
});

describe('approve/reject: per-status table (B3)', () => {
  const STATUSES = ['rejected', 'cancelled', 'expired', 'failed'] as const;

  it('executed: approve is 200 idempotent with the stored after; reject is 409 proposal_not_pending; no writes', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary();
    Object.assign(proposalRow(id), { status: 'executed', result: '{"learned":"stored after"}' });
    mockFake.queries.length = 0;
    const a = await approve(id, { expectedUpdatedAt });
    expect([a.status, a.body.ok, a.body.data.status, a.body.data.idempotent]).toEqual([200, true, 'executed', true]);
    expect(a.body.data.after).toEqual({ learned: 'stored after' });
    const r = await reject(id);
    expect([r.status, r.body.error, r.body.status]).toEqual([409, 'proposal_not_pending', 'executed']);
    expect(writes('agent_proposals')).toEqual([]);
    expect(writes('diary_entries')).toEqual([]);
    expect(diaryRow().learned).toBe('old learned');
  });

  for (const status of STATUSES) {
    it(`${status}: approve and reject are both 409 proposal_not_pending with { status }, no writes`, async () => {
      const { id, expectedUpdatedAt } = await proposeDiary();
      Object.assign(proposalRow(id), { status });
      mockFake.queries.length = 0;
      const a = await approve(id, { expectedUpdatedAt });
      expect([a.status, a.body.ok, a.body.error, a.body.status]).toEqual([409, false, 'proposal_not_pending', status]);
      const r = await reject(id);
      expect([r.status, r.body.error, r.body.status]).toEqual([409, 'proposal_not_pending', status]);
      expect(proposalRow(id).status).toBe(status);
      expect(writes('agent_proposals')).toEqual([]);
      expect(writes('diary_entries')).toEqual([]);
    });
  }

  it('failed with result.error = target_missing is also 409 proposal_not_pending', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary();
    Object.assign(proposalRow(id), { status: 'failed', result: '{"error":"target_missing"}' });
    const a = await approve(id, { expectedUpdatedAt });
    expect([a.status, a.body.error, a.body.status]).toEqual([409, 'proposal_not_pending', 'failed']);
  });

  it('unknown id is 404 for approve and reject', async () => {
    expect((await approve('prp_missing', { expectedUpdatedAt: null })).status).toBe(404);
    expect((await reject('prp_missing')).status).toBe(404);
  });
});

describe('approve: pending error paths', () => {
  it('stale_client: 409 with no proposal or target write', async () => {
    const { id } = await proposeDiary();
    mockFake.queries.length = 0;
    const res = await approve(id, { expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect([res.status, res.body.error, res.body.status]).toEqual([409, 'stale_client', 'pending']);
    expect(writes('agent_proposals')).toEqual([]);
    expect(writes('diary_entries')).toEqual([]);
    expect(proposalRow(id).expected_updated_at).toBe(DIARY_TS);
    expect(diaryRow().learned).toBe('old learned');
  });

  it('stale: 409 commits the refreshed before/expected_updated_at; re-approve with the new value executes', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary();
    Object.assign(diaryRow(), { learned: 'edited by user', updated_at: '2026-09-02T00:00:00.000Z' });
    const stale = await approve(id, { expectedUpdatedAt });
    expect([stale.status, stale.body.error, stale.body.status]).toEqual([409, 'stale', 'pending']);
    expect(stale.body.proposal.before).toEqual({ learned: 'edited by user' });
    expect(stale.body.proposal.expectedUpdatedAt).toBe('2026-09-02T00:00:00.000Z');
    const row = proposalRow(id);
    expect([row.status, row.expected_updated_at, json(row.before)]).toEqual(['pending', '2026-09-02T00:00:00.000Z', { learned: 'edited by user' }]);
    expect(Boolean(row.refreshed_at)).toBe(true);
    expect(diaryRow().learned).toBe('edited by user');

    const again = await approve(id, { expectedUpdatedAt: '2026-09-02T00:00:00.000Z' });
    expect([again.status, again.body.data.status]).toEqual([200, 'executed']);
    expect(diaryRow().learned).toBe('new learned');
  });

  it('expired: 410 and the status becomes expired', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary();
    proposalRow(id).__expired = true;
    const res = await approve(id, { expectedUpdatedAt });
    expect([res.status, res.body.error, res.body.status]).toEqual([410, 'expired', 'expired']);
    expect(proposalRow(id).status).toBe('expired');
    expect(diaryRow().learned).toBe('old learned');
  });

  it('revoked token: the proposal becomes cancelled and approve is 409; no target write', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary();
    mockFake.tokens[0].revoked = true;
    const res = await approve(id, { expectedUpdatedAt });
    expect([res.status, res.body.error, res.body.status]).toEqual([409, 'token_revoked', 'cancelled']);
    expect(proposalRow(id).status).toBe('cancelled');
    expect(writes('diary_entries')).toEqual([]);
    // The revocation read is a plain SELECT: never a token lock (M7).
    expect(mockFake.queries.some((q) => q.sql.includes('from "agent_tokens"') && / for (update|no key update|share)$/.test(q.sql) && q.sql.startsWith('select "revoked_at"'))).toBe(false);
  });

  it('warnings without acknowledgement: 422 and no change; with acknowledgement it executes', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary({ notes: '=HYPERLINK("x")' });
    const res = await approve(id, { expectedUpdatedAt });
    expect([res.status, res.body.error]).toEqual([422, 'warnings_not_acknowledged']);
    expect(proposalRow(id).status).toBe('pending');
    expect(diaryRow().notes).toBe('keep notes');
    const ok = await approve(id, { expectedUpdatedAt, acknowledgeWarnings: true });
    expect(ok.status).toBe(200);
    expect(diaryRow().notes).toBe('=HYPERLINK("x")');
  });

  it('executor throw: rollback, status failed with a truncated message, target unchanged', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary();
    mockFake.failWith = (q) => (q.sql.startsWith('update "diary_entries"') ? pgError('XX000', 'x'.repeat(2_000)) : undefined);
    const res = await approve(id, { expectedUpdatedAt });
    expect([res.status, res.body.error, res.body.status]).toEqual([500, 'execution_failed', 'failed']);
    const row = proposalRow(id);
    expect(row.status).toBe('failed');
    const result = json(row.result) as { error: string };
    expect(result.error).toHaveLength(MAX_FAILURE_MESSAGE_LENGTH);
    expect(result.error.includes('params')).toBe(false);
    expect(diaryRow().learned).toBe('old learned');
    expect(mockFake.audit.filter((a) => a.action === 'approve').map((a) => a.status_code)).toEqual([500]);
  });

  it('M1: approve A throws after approve B executed and committed; A updates 0 rows and returns executed', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary();
    let sawFailedUpdate = false;
    mockFake.failWith = (q) => {
      if (q.sql.startsWith('update "diary_entries"')) return pgError('40001', 'serialization failure in A');
      if (q.sql.startsWith('update "agent_proposals"') && q.params.includes('failed')) {
        // B committed between A's rollback and A's second transaction.
        sawFailedUpdate = true;
        Object.assign(proposalRow(id), { status: 'executed', result: '{"learned":"by B"}', decided_by: 'b@example.com' });
      }
      return undefined;
    };
    const res = await approve(id, { expectedUpdatedAt });
    expect(sawFailedUpdate).toBe(true);
    expect([res.status, res.body.ok, res.body.data.status, res.body.data.idempotent]).toEqual([200, true, 'executed', true]);
    expect(res.body.data.after).toEqual({ learned: 'by B' });
    const row = proposalRow(id);
    expect([row.status, row.decided_by]).toEqual(['executed', 'b@example.com']);
  });

  it('target missing for a delete: 409 target_missing, failed; a second approve is 409 proposal_not_pending', async () => {
    const { id, expectedUpdatedAt } = await propose({ domain: 'diary', operation: 'delete', target: { rowNumber: 14 } });
    mockFake.tables.diary_entries = [];
    const first = await approve(id, { expectedUpdatedAt });
    expect([first.status, first.body.error, first.body.status]).toEqual([409, 'target_missing', 'failed']);
    expect(json(proposalRow(id).result)).toEqual({ error: 'target_missing' });
    expect(mockFake.audit.filter((a) => a.action === 'approve').map((a) => a.status_code)).toEqual([409]);
    const second = await approve(id, { expectedUpdatedAt });
    expect([second.status, second.body.error, second.body.status]).toEqual([409, 'proposal_not_pending', 'failed']);
  });

  it('target missing for a schedule update: 409 target_missing', async () => {
    const { id, expectedUpdatedAt } = await propose({ domain: 'schedule', operation: 'update', target: { id: 'sched-row-5' }, changes: { notes: 'x' } });
    mockFake.tables.activities = [];
    const res = await approve(id, { expectedUpdatedAt });
    expect([res.status, res.body.error]).toEqual([409, 'target_missing']);
  });

  it('a deleted diary row under an update proposal is stale with before null; re-approve inserts it (M6)', async () => {
    const { id, expectedUpdatedAt } = await proposeDiary();
    mockFake.tables.diary_entries = [];
    const stale = await approve(id, { expectedUpdatedAt });
    expect([stale.status, stale.body.error]).toEqual([409, 'stale']);
    expect(stale.body.proposal.before).toBeNull();
    expect(stale.body.proposal.expectedUpdatedAt).toBeNull();
    const again = await approve(id, { expectedUpdatedAt: null });
    expect(again.status).toBe(200);
    expect(diaryRow().learned).toBe('new learned');
  });
});

describe('reject', () => {
  it('pending -> rejected with decided_by, stored reason and an audit row; second reject is 409', async () => {
    const { id } = await proposeDiary();
    const res = await reject(id, { reason: 'not now' });
    expect([res.status, res.body.data.status]).toEqual([200, 'rejected']);
    const row = proposalRow(id);
    expect([row.status, row.decided_by, json(row.result)]).toEqual(['rejected', OWNER, { reason: 'not now' }]);
    expect(diaryRow().learned).toBe('old learned');
    const audit = mockFake.audit.filter((a) => a.action === 'reject');
    expect(audit.map((a) => a.status_code)).toEqual([200]);
    expect(JSON.stringify(audit[0].details).includes('not now')).toBe(false);
    const again = await reject(id);
    expect([again.status, again.body.error, again.body.status]).toEqual([409, 'proposal_not_pending', 'rejected']);
  });
});

describe('admin route plumbing', () => {
  it('approve body validation: missing expectedUpdatedAt and unknown keys are 400', async () => {
    const { id } = await proposeDiary();
    expect((await approve(id, {})).status).toBe(400);
    expect((await approve(id, { expectedUpdatedAt: null, extra: 1 })).status).toBe(400);
    expect((await approve(id, { expectedUpdatedAt: null, acknowledgeWarnings: 'yes' })).status).toBe(400);
  });

  it('no secret: approve and reject are 503 auth_secret_required', async () => {
    const { id } = await proposeDiary();
    delete process.env.AUTH_SECRET;
    const a = await approve(id, { expectedUpdatedAt: null });
    const r = await reject(id);
    expect([a.status, a.body.error, r.status, r.body.error]).toEqual([503, 'auth_secret_required', 503, 'auth_secret_required']);
    expect(proposalRow(id).status).toBe('pending');
  });

  it('GET countOnly counts unexpired pending; 42P01 maps to 200 agent_tables_missing', async () => {
    const a = await proposeDiary({ learned: 'a' });
    await proposeDiary({ learned: 'b' });
    proposalRow(a.id).__expired = true;
    const get = (url: string) =>
      listRoute.GET(new Request(url, { headers: { cookie: `nova_session=${cookie}` } }), { params: Promise.resolve({}) });
    const count = await get(`${BASE}?countOnly=1`);
    expect(count.status).toBe(200);
    expect(count.headers.get('cache-control')).toBe('no-store');
    expect(((await count.json()) as Body).data).toEqual({ count: 1 });

    expect((await get(`${BASE}?status=bogus`)).status).toBe(400);

    mockFake.failWith = () => pgError('42P01', 'relation "agent_proposals" does not exist');
    const missing = await get(`${BASE}?countOnly=1`);
    expect(missing.status).toBe(200);
    const body = (await missing.json()) as Body;
    expect([body.ok, body.error]).toEqual([false, 'agent_tables_missing']);
  });

  it('42P01 on approve maps to 503 agent_tables_missing', async () => {
    mockFake.failWith = () => pgError('42P01');
    const res = await approve('prp_x', { expectedUpdatedAt: null });
    expect([res.status, res.body.error]).toEqual([503, 'agent_tables_missing']);
  });

  it('failureMessage prefers the innermost cause and truncates', () => {
    const inner = new Error('inner message');
    const outer = Object.assign(new Error('Failed query: update ... params: secret'), { cause: inner });
    expect(failureMessage(outer)).toBe('inner message');
    expect(failureMessage(new Error('y'.repeat(900)))).toHaveLength(MAX_FAILURE_MESSAGE_LENGTH);
  });
});
