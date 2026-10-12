/**
 * Integration test: owner approval against a real, LOCAL, already-migrated Postgres. Reads
 * TEST_DATABASE_URL only (never DATABASE_URL); refuses any host other than localhost/127.0.0.1.
 * Skipped when unset, except under CI where a missing URL fails (B4). Run in band:
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/ci_test pnpm test --runInBand lib/agent/approvals.integration.test.ts
 *
 * The pool is `max: 2` like production (M5), so any query that escaped its transaction would
 * self-deadlock. Covers (a) concurrent approves, (b) approve racing a token revoke (S13, M7),
 * (c) microsecond `activities.updated_at` (M4), (d) a second proposal on the same row goes stale
 * (M2), (e) deleted targets (M6) and (f) an update for an absent diary row inserts it.
 */
import { randomInt } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray, like, sql as dsql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { resolveSslOption } from '@/lib/db/ssl';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const testDatabaseUrl = process.env.TEST_DATABASE_URL || undefined;

if (testDatabaseUrl !== undefined) {
  let hostname: string;
  try {
    hostname = new URL(testDatabaseUrl).hostname;
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL; refusing to run the integration test.');
  }
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`TEST_DATABASE_URL host "${hostname}" is not localhost or 127.0.0.1; refusing to connect.`);
  }
}

const jestDescribe = (globalThis as unknown as { describe: jest.Describe }).describe;
const describeWithDb = testDatabaseUrl === undefined ? jestDescribe.skip : jestDescribe;

if (testDatabaseUrl === undefined && Boolean(process.env.CI)) {
  it('requires TEST_DATABASE_URL when CI is set', () => {
    throw new Error('CI is set but TEST_DATABASE_URL is missing; the approvals integration test must not be skipped in CI.');
  });
}

type Db = ReturnType<typeof drizzle<typeof schema>>;
let mockDb: Db | null = null;
// jest.mock is not hoisted by this repo's transform; modules using @/lib/db are required below.
jest.mock('@/lib/db', () => ({
  isDbConfigured: () => true,
  get db() {
    if (!mockDb) throw new Error('integration db not initialised');
    return mockDb;
  },
}));

const { createProposal } = require('./proposals') as typeof import('./proposals');
const { approveProposal, rejectProposal, listAdminProposals } = require('./approvals') as typeof import('./approvals');
const { revokeAgentToken } = require('./tokens-admin') as typeof import('./tokens-admin');
const { generateAgentToken } = require('./tokens') as typeof import('./tokens');
type DecisionOutcome = import('./approvals').DecisionOutcome;

const OWNER = { email: 'owner@example.com', path: '/api/agent-admin/proposals/x/approve' };
const SCOPES = ['diary:propose', 'schedule:propose', 'timeline:propose', 'feedback:propose'];
const RACE_ITERATIONS = 25;
const STEP_TIMEOUT_MS = 15_000;

jest.setTimeout(120_000);

/** Fails fast (instead of hanging until the jest timeout) if a pool self-deadlock occurs. */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${STEP_TIMEOUT_MS} ms (deadlock?)`)), STEP_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function brief(outcome: DecisionOutcome): Record<string, unknown> {
  return outcome.ok
    ? { ok: true, http: outcome.httpStatus, status: outcome.status, idempotent: outcome.idempotent }
    : { ok: false, http: outcome.httpStatus, error: outcome.error, status: outcome.status };
}

describeWithDb('agent approvals (integration, TEST_DATABASE_URL)', () => {
  let client: postgres.Sql;
  let db: Db;
  const suffix = `${randomInt(0, 1e9)}_${Date.now()}`;
  const tokenPrefix = `tok_apr_it_${suffix}`;
  const tokenIds: string[] = [];
  const baseRow = 800_000 + randomInt(0, 90_000);
  const rows = { concurrent: baseRow, race: baseRow + 1, m2: baseRow + 2, delDelete: baseRow + 3, delUpdate: baseRow + 4, absent: baseRow + 5 };
  const activityId = `sched-row-apr-it-${suffix}`;
  const activityGoneId = `sched-row-apr-gone-${suffix}`;
  const stageGoneId = `stage-apr-gone-${suffix}`;
  const feedbackSessionId = `fbs-apr-it-${suffix}`;
  let tokenSeq = 0;
  let idemSeq = 0;
  const raceTally = { executed: 0, cancelled: 0 };

  async function newToken(): Promise<string> {
    tokenSeq += 1;
    const id = `${tokenPrefix}_${tokenSeq}`;
    const generated = generateAgentToken();
    await db.insert(schema.agentTokens).values({
      id,
      name: `approvals-it-${tokenSeq}`,
      tokenPrefix: generated.prefix,
      tokenHash: generated.hash,
      scopes: SCOPES,
      createdBy: 'integration-test',
    });
    tokenIds.push(id);
    return id;
  }

  let mainToken = '';

  async function propose(body: Record<string, unknown>, tokenId = mainToken): Promise<{ id: string; expected: string | null }> {
    idemSeq += 1;
    const result = await createProposal({ tokenId, scopes: SCOPES }, { reason: 'integration', idempotencyKey: `idem-apr-${suffix}-${idemSeq}`, ...body });
    if (!result.outcome.ok) throw new Error(`proposal failed: ${result.outcome.error}`);
    return { id: result.outcome.proposal.id, expected: result.outcome.proposal.expectedUpdatedAt };
  }

  async function status(id: string): Promise<string> {
    const r = await client`select status from agent_proposals where id = ${id}`;
    return r[0].status as string;
  }

  async function diaryEntry(rowNumber: number): Promise<{ learned: string; notes: string; updated_at: string } | undefined> {
    const r = await client`select learned, notes, updated_at from diary_entries where row_number = ${rowNumber}`;
    return r[0] as { learned: string; notes: string; updated_at: string } | undefined;
  }

  beforeAll(async () => {
    const url = testDatabaseUrl as string;
    client = postgres(url, { max: 2, ssl: resolveSslOption(url), onnotice: () => {} });
    db = drizzle(client, { schema });
    mockDb = db;
    mainToken = await newToken();
    for (const rowNumber of Object.values(rows)) {
      await db.insert(schema.diaryTopics).values({
        id: `topic_apr_it_${suffix}_${rowNumber}`,
        rowNumber,
        day: 'Monday',
        week: 'Week 1',
        date: '01/09/2026',
        pic: 'HR',
        topic: 'Approval integration topic',
        defaultLearned: 'default learned',
        defaultNotes: 'default notes',
      });
    }
    for (const id of [activityId, activityGoneId]) {
      await db.insert(schema.activities).values({
        id,
        rowNumber: baseRow,
        week: 'Week 1',
        day: 'Monday',
        date: '01/09/2026',
        pic: 'HR',
        topic: 'Approval integration activity',
        mainMedia: 'Online',
        progress: 'In Progress',
        startTime: '09:00',
        notes: 'old notes',
        updatedAt: dsql`'2026-09-01 03:04:05.123456+00'::timestamptz`,
      });
    }
    await db.insert(schema.timelineStages).values({
      id: stageGoneId,
      stageNumber: '98',
      stageName: 'Approval integration stage',
      startDate: '01/09/2026',
      endDate: '30/09/2026',
      objective: 'o',
      keyActivities: 'k',
      outputsEvidence: 'e',
      minimumDuration: '1 Month',
      completedEvidence: ['a'],
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    await db.insert(schema.feedbackSessions).values({
      id: feedbackSessionId,
      title: 'Approval integration session',
      topic: 'Integration feedback topic',
      pic: 'HR',
      rowNumber: baseRow,
      department: 'HR',
    });
  });

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (db) {
      if (tokenIds.length > 0) {
        await db.delete(schema.agentAuditLog).where(inArray(schema.agentAuditLog.tokenId, tokenIds));
        await db.delete(schema.agentProposals).where(inArray(schema.agentProposals.tokenId, tokenIds));
        await db.delete(schema.agentTokens).where(inArray(schema.agentTokens.id, tokenIds));
      }
      await db.delete(schema.diaryEntries).where(inArray(schema.diaryEntries.rowNumber, Object.values(rows)));
      await db.delete(schema.diaryTopics).where(like(schema.diaryTopics.id, `topic_apr_it_${suffix}_%`));
      await db.delete(schema.activities).where(inArray(schema.activities.id, [activityId, activityGoneId]));
      await db.delete(schema.timelineStages).where(eq(schema.timelineStages.id, stageGoneId));
      await db.delete(schema.feedbackEntries).where(eq(schema.feedbackEntries.sessionId, feedbackSessionId));
      await db.delete(schema.feedbackSessions).where(eq(schema.feedbackSessions.id, feedbackSessionId));
      process.stdout.write(`[approvals.integration] approve-vs-revoke race over ${RACE_ITERATIONS} runs: executed=${raceTally.executed} cancelled=${raceTally.cancelled}\n`);
    }
    mockDb = null;
    await client?.end();
  });

  it('(a) M5: two concurrent approves of one proposal -> exactly one executes, the other is 200-idempotent, no deadlock', async () => {
    for (let i = 0; i < 10; i += 1) {
      const { id, expected } = await propose({ domain: 'diary', operation: 'update', target: { rowNumber: rows.concurrent }, changes: { learned: `concurrent ${i}` } });
      const outcomes = await withTimeout(
        Promise.all([approveProposal(id, { expectedUpdatedAt: expected }, OWNER), approveProposal(id, { expectedUpdatedAt: expected }, OWNER)]),
        'concurrent approves'
      );
      const briefs = outcomes.map(brief);
      expect(briefs.every((b) => b.ok === true && b.http === 200 && b.status === 'executed')).toBe(true);
      expect(briefs.filter((b) => b.idempotent === false)).toHaveLength(1);
      expect(await status(id)).toBe('executed');
      expect((await diaryEntry(rows.concurrent))?.learned).toBe(`concurrent ${i}`);
      const audit = await client`select status_code from agent_audit_log where proposal_id = ${id} and action = 'approve'`;
      expect(audit.map((r) => r.status_code)).toEqual([200, 200]);
    }
  });

  it(`(b) S13/M7: approve racing a token revoke -> executed xor cancelled, no deadlock, no target write after cancel (${RACE_ITERATIONS} runs)`, async () => {
    for (let i = 0; i < RACE_ITERATIONS; i += 1) {
      const tokenId = await newToken();
      const value = `race ${i} ${suffix}`;
      const { id, expected } = await propose({ domain: 'diary', operation: 'update', target: { rowNumber: rows.race }, changes: { learned: value } }, tokenId);
      const beforeRow = await diaryEntry(rows.race);
      // Stagger the starts (0-4 ms, alternating which side waits) so both orderings occur.
      const lag = i % 5;
      const later = <T,>(fn: () => Promise<T>): Promise<T> => new Promise((resolve) => setTimeout(resolve, lag)).then(fn);
      const approve = () => approveProposal(id, { expectedUpdatedAt: expected }, OWNER);
      const revoke = () => revokeAgentToken(db, tokenId, OWNER.email);
      const [approved, revoked] = await withTimeout(
        i % 2 === 0 ? Promise.all([approve(), later(revoke)]) : Promise.all([later(approve), revoke()]),
        `approve-vs-revoke run ${i}`
      );
      expect(revoked.status).toBe('revoked');
      const final = await status(id);
      const afterRow = await diaryEntry(rows.race);
      const cancelledIds = revoked.status === 'revoked' ? revoked.cancelledProposalIds : [];
      if (final === 'executed') {
        raceTally.executed += 1;
        expect(brief(approved)).toEqual({ ok: true, http: 200, status: 'executed', idempotent: false });
        expect(cancelledIds).toEqual([]);
        expect(afterRow?.learned).toBe(value);
      } else {
        raceTally.cancelled += 1;
        expect(final).toBe('cancelled');
        expect(approved.ok).toBe(false);
        expect(approved.httpStatus).toBe(409);
        expect(['token_revoked', 'proposal_not_pending']).toContain(approved.ok ? '' : approved.error);
        // Never a target write after cancel.
        expect(afterRow).toEqual(beforeRow);
      }
    }
    expect(raceTally.executed + raceTally.cancelled).toBe(RACE_ITERATIONS);
  });

  it('(c) M4: an unchanged activities row with microseconds executes first time; a later update is detected as stale', async () => {
    const first = await propose({ domain: 'schedule', operation: 'update', target: { id: activityId }, changes: { notes: 'agent notes' } });
    expect(first.expected).toBe('2026-09-01 03:04:05.123456+00');
    expect(brief(await approveProposal(first.id, { expectedUpdatedAt: first.expected }, OWNER))).toEqual({
      ok: true,
      http: 200,
      status: 'executed',
      idempotent: false,
    });
    const row = await client`select notes, progress, start_time, updated_at::text as ts from activities where id = ${activityId}`;
    expect([row[0].notes, row[0].progress, row[0].start_time]).toEqual(['agent notes', 'In Progress', '09:00']);
    expect(row[0].ts).not.toBe('2026-09-01 03:04:05.123456+00');

    const second = await propose({ domain: 'schedule', operation: 'update', target: { id: activityId }, changes: { progress: 'Done' } });
    await client`update activities set notes = 'user edit', updated_at = updated_at + interval '1 microsecond' where id = ${activityId}`;
    const stale = await approveProposal(second.id, { expectedUpdatedAt: second.expected }, OWNER);
    expect(brief(stale)).toEqual({ ok: false, http: 409, error: 'stale', status: 'pending' });
    const refreshed = await client`select expected_updated_at, refreshed_at is not null as refreshed from agent_proposals where id = ${second.id}`;
    expect(refreshed[0].refreshed).toBe(true);
    expect(refreshed[0].expected_updated_at).not.toBe(second.expected);
    const again = await approveProposal(second.id, { expectedUpdatedAt: refreshed[0].expected_updated_at as string }, OWNER);
    expect(brief(again)).toEqual({ ok: true, http: 200, status: 'executed', idempotent: false });
    const done = await client`select progress, notes from activities where id = ${activityId}`;
    expect([done[0].progress, done[0].notes]).toEqual(['Done', 'user edit']);
  });

  it('(d) M2: two pending proposals on one diary row -> the first executes, the second is 409 stale', async () => {
    const a = await propose({ domain: 'diary', operation: 'update', target: { rowNumber: rows.m2 }, changes: { learned: 'first' } });
    const b = await propose({ domain: 'diary', operation: 'update', target: { rowNumber: rows.m2 }, changes: { learned: 'second' } });
    expect(brief(await approveProposal(a.id, { expectedUpdatedAt: a.expected }, OWNER)).status).toBe('executed');
    const second = await approveProposal(b.id, { expectedUpdatedAt: b.expected }, OWNER);
    expect(brief(second)).toEqual({ ok: false, http: 409, error: 'stale', status: 'pending' });
    expect(second.ok ? null : second.proposal?.before).toEqual({ learned: 'first' });
    expect((await diaryEntry(rows.m2))?.learned).toBe('first');
  });

  it('(e) M6: deleted target -> target_missing/failed for delete and schedule/timeline update; then proposal_not_pending', async () => {
    await db.insert(schema.diaryEntries).values({ id: `entry-${rows.delDelete}`, rowNumber: rows.delDelete, learned: 'l', notes: 'n', updatedAt: '2026-09-01T00:00:00.000Z' });
    const del = await propose({ domain: 'diary', operation: 'delete', target: { rowNumber: rows.delDelete } });
    const sched = await propose({ domain: 'schedule', operation: 'update', target: { id: activityGoneId }, changes: { notes: 'x' } });
    const stage = await propose({ domain: 'timeline', operation: 'update', target: { stageId: stageGoneId }, changes: { completedEvidence: ['b'] } });
    await client`delete from diary_entries where row_number = ${rows.delDelete}`;
    await client`delete from activities where id = ${activityGoneId}`;
    await client`delete from timeline_stages where id = ${stageGoneId}`;

    for (const p of [del, sched, stage]) {
      const first = await approveProposal(p.id, { expectedUpdatedAt: p.expected }, OWNER);
      expect(brief(first)).toEqual({ ok: false, http: 409, error: 'target_missing', status: 'failed' });
      const stored = await client`select status, result from agent_proposals where id = ${p.id}`;
      expect([stored[0].status, stored[0].result]).toEqual(['failed', { error: 'target_missing' }]);
      const second = await approveProposal(p.id, { expectedUpdatedAt: p.expected }, OWNER);
      expect(brief(second)).toEqual({ ok: false, http: 409, error: 'proposal_not_pending', status: 'failed' });
    }
    const audit = await client`select status_code from agent_audit_log where proposal_id = ${del.id} and action = 'approve' order by created_at`;
    expect(audit.map((r) => r.status_code)).toEqual([409, 409]);
  });

  it('(e) M6: a deleted diary/feedback row under an update proposal is stale with before null; re-approve inserts it', async () => {
    await db.insert(schema.diaryEntries).values({ id: `entry-${rows.delUpdate}`, rowNumber: rows.delUpdate, learned: 'l', notes: 'kept?', updatedAt: '2026-09-01T00:00:00.000Z' });
    await db.insert(schema.feedbackEntries).values({ id: `fb-${feedbackSessionId}`, sessionId: feedbackSessionId, rowNumber: baseRow, suggestions: 'old', updatedAt: '2026-09-01T00:00:00.000Z' });
    const diary = await propose({ domain: 'diary', operation: 'update', target: { rowNumber: rows.delUpdate }, changes: { learned: 'after delete' } });
    const feedback = await propose({ domain: 'feedback', operation: 'update', target: { sessionId: feedbackSessionId }, changes: { suggestions: 'after delete' } });
    expect(diary.expected).toBe('2026-09-01T00:00:00.000Z');
    await client`delete from diary_entries where row_number = ${rows.delUpdate}`;
    await client`delete from feedback_entries where session_id = ${feedbackSessionId}`;

    for (const p of [diary, feedback]) {
      const stale = await approveProposal(p.id, { expectedUpdatedAt: p.expected }, OWNER);
      expect(brief(stale)).toEqual({ ok: false, http: 409, error: 'stale', status: 'pending' });
      expect(stale.ok ? 'x' : stale.proposal?.before).toBeNull();
      expect(stale.ok ? 'x' : stale.proposal?.expectedUpdatedAt).toBeNull();
      const raw = await client`select before is null as before_null, expected_updated_at is null as expected_null from agent_proposals where id = ${p.id}`;
      expect([raw[0].before_null, raw[0].expected_null]).toEqual([true, true]);
      expect(brief(await approveProposal(p.id, { expectedUpdatedAt: null }, OWNER))).toEqual({ ok: true, http: 200, status: 'executed', idempotent: false });
    }
    const d = await diaryEntry(rows.delUpdate);
    expect([d?.learned, d?.notes]).toEqual(['after delete', 'default notes']);
    const f = await client`select suggestions, row_number, topic from feedback_entries where session_id = ${feedbackSessionId}`;
    expect([f[0].suggestions, f[0].row_number, f[0].topic]).toEqual(['after delete', baseRow, 'Integration feedback topic']);
  });

  it('(f) an update for an absent diary row (before SQL NULL) executes on the first approve and inserts the row', async () => {
    expect(await diaryEntry(rows.absent)).toBeUndefined();
    const p = await propose({ domain: 'diary', operation: 'update', target: { rowNumber: rows.absent }, changes: { notes: 'brand new' } });
    expect(p.expected).toBeNull();
    const raw = await client`select before is null as before_null from agent_proposals where id = ${p.id}`;
    expect(raw[0].before_null).toBe(true);
    expect(brief(await approveProposal(p.id, { expectedUpdatedAt: null }, OWNER))).toEqual({ ok: true, http: 200, status: 'executed', idempotent: false });
    const row = await diaryEntry(rows.absent);
    expect([row?.learned, row?.notes]).toEqual(['default learned', 'brand new']);
  });

  it('reject, and the admin list joins the token name', async () => {
    const p = await propose({ domain: 'diary', operation: 'update', target: { rowNumber: rows.absent }, changes: { learned: 'rejected value' } });
    const listed = await listAdminProposals(db, { status: 'pending' });
    const mine = listed.find((v) => v.id === p.id);
    expect([mine?.tokenName, mine?.expectedUpdatedAt === p.expected, Array.isArray(mine?.warnings)]).toEqual(['approvals-it-1', true, true]);
    expect(brief(await rejectProposal(p.id, { reason: 'no' }, OWNER))).toEqual({ ok: true, http: 200, status: 'rejected', idempotent: false });
    expect(brief(await approveProposal(p.id, { expectedUpdatedAt: p.expected }, OWNER))).toEqual({
      ok: false,
      http: 409,
      error: 'proposal_not_pending',
      status: 'rejected',
    });
    expect((await diaryEntry(rows.absent))?.learned).toBe('default learned');
  });
});
