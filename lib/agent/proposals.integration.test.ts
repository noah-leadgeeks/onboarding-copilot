/**
 * Integration test: proposal creation against a real, LOCAL, already-migrated Postgres. Reads
 * TEST_DATABASE_URL only (never DATABASE_URL); refuses any host other than localhost/127.0.0.1.
 * Skipped when unset, except under CI where a missing URL fails. Run in band:
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/ci_test pnpm test --runInBand lib/agent/proposals.integration.test.ts
 *
 * Covers M3 (SQL NULL `before`/`expected_updated_at` for an absent diary entry, JSON null in the
 * API), M4 (`activities` snapshot keeps microseconds) and that each domain's `apply` SQL runs
 * (inside a transaction that is always rolled back).
 */
import { randomInt } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray, sql as dsql } from 'drizzle-orm';
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
    throw new Error('CI is set but TEST_DATABASE_URL is missing; the proposals integration test must not be skipped in CI.');
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
const { DOMAINS } = require('./domains') as typeof import('./domains');
const { generateAgentToken } = require('./tokens') as typeof import('./tokens');
type AgentTransaction = import('./audit').AgentTransaction;

type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const proposalsRoute = require('@/app/api/agent/v1/proposals/route') as { POST: RouteHandler };
const proposalRoute = require('@/app/api/agent/v1/proposals/[id]/route') as { GET: RouteHandler };

class Rollback extends Error {}

type Outcome = import('./proposals').ProposalOutcome;
/** The comparable core of an outcome (lib/test-globals.d.ts has no toMatchObject). */
function brief(outcome: Outcome): Record<string, unknown> {
  return outcome.ok
    ? { ok: true, status: outcome.status, replayed: outcome.replayed }
    : { ok: false, status: outcome.status, error: outcome.error };
}

function pick(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

describeWithDb('agent proposals (integration, TEST_DATABASE_URL)', () => {
  let client: postgres.Sql;
  let db: Db;
  const suffix = `${randomInt(0, 1e9)}_${Date.now()}`;
  const tokenId = `tok_prp_it_${suffix}`;
  const token = generateAgentToken();
  const rowNumber = 900_000 + randomInt(0, 99_999);
  const topicId = `topic_it_${suffix}`;
  const activityId = `sched-row-it-${suffix}`;
  const stageId = `stage-it-${suffix}`;
  const caller = { tokenId, scopes: ['diary:propose', 'schedule:propose', 'timeline:propose'] };

  beforeAll(async () => {
    const url = testDatabaseUrl as string;
    client = postgres(url, { max: 2, ssl: resolveSslOption(url), onnotice: () => {} });
    db = drizzle(client, { schema });
    mockDb = db;
    await db.insert(schema.agentTokens).values({
      id: tokenId,
      name: 'proposals-integration',
      tokenPrefix: token.prefix,
      tokenHash: token.hash,
      scopes: caller.scopes,
      createdBy: 'integration-test',
    });
    await db.insert(schema.diaryTopics).values({
      id: topicId,
      rowNumber,
      day: 'Monday',
      week: 'Week 1',
      date: '01/09/2026',
      pic: 'HR',
      topic: 'Integration topic',
      defaultLearned: 'default learned',
      defaultNotes: 'default notes',
    });
    await db.insert(schema.activities).values({
      id: activityId,
      rowNumber,
      week: 'Week 1',
      day: 'Monday',
      date: '01/09/2026',
      pic: 'HR',
      topic: 'Integration activity',
      mainMedia: 'Online',
      notes: 'old notes',
      updatedAt: dsql`'2026-09-01 03:04:05.123456+00'::timestamptz`,
    });
    await db.insert(schema.timelineStages).values({
      id: stageId,
      stageNumber: '99',
      stageName: 'Integration stage',
      startDate: '01/09/2026',
      endDate: '30/09/2026',
      objective: 'o',
      keyActivities: 'k',
      outputsEvidence: 'e',
      minimumDuration: '1 Month',
      completedEvidence: ['a'],
      updatedAt: '2026-09-01T00:00:00.000Z',
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
      await db.delete(schema.agentAuditLog).where(eq(schema.agentAuditLog.tokenId, tokenId));
      await db.delete(schema.agentProposals).where(eq(schema.agentProposals.tokenId, tokenId));
      await db.delete(schema.agentTokens).where(eq(schema.agentTokens.id, tokenId));
      await db.delete(schema.diaryEntries).where(eq(schema.diaryEntries.rowNumber, rowNumber));
      await db.delete(schema.diaryTopics).where(eq(schema.diaryTopics.id, topicId));
      await db.delete(schema.activities).where(eq(schema.activities.id, activityId));
      await db.delete(schema.timelineStages).where(inArray(schema.timelineStages.id, [stageId]));
    }
    mockDb = null;
    await client?.end();
  });

  it('M3: a proposal for a missing diary_entries row stores SQL NULL before/expected_updated_at and the API returns JSON null', async () => {
    const response = await proposalsRoute.POST(
      new Request('http://localhost/api/agent/v1/proposals', {
        method: 'POST',
        headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          domain: 'diary',
          operation: 'update',
          target: { rowNumber },
          changes: { learned: 'learned via agent' },
          reason: 'integration',
          idempotencyKey: `idem-m3-${suffix}`,
        }),
      }),
      { params: Promise.resolve({}) }
    );
    expect(response.status).toBe(202);
    const created = (await response.json()) as { ok: boolean; data: { id: string; before: unknown; expectedUpdatedAt: unknown } };
    expect(created.ok).toBe(true);
    expect(created.data.before).toBeNull();
    expect(created.data.expectedUpdatedAt).toBeNull();

    const raw = await client`
      select before is null as before_null, expected_updated_at is null as expected_null, status, target_key
      from agent_proposals where id = ${created.data.id}`;
    expect(pick(raw[0], ['before_null', 'expected_null', 'status', 'target_key'])).toEqual({
      before_null: true,
      expected_null: true,
      status: 'pending',
      target_key: { rowNumber },
    });

    const read = await proposalRoute.GET(
      new Request(`http://localhost/api/agent/v1/proposals/${created.data.id}`, {
        headers: { authorization: `Bearer ${token.token}` },
      }),
      { params: Promise.resolve({ id: created.data.id }) }
    );
    expect(read.status).toBe(200);
    const text = await read.text();
    expect(text).toContain('"before":null');
    expect(text).toContain('"expectedUpdatedAt":null');

    const audit = await client`
      select action, status_code, proposal_id from agent_audit_log
      where token_id = ${tokenId} and proposal_id = ${created.data.id} order by created_at`;
    expect(audit.map((row) => row.action)).toEqual(['propose.diary.update', 'read.proposals']);
    expect(audit[0].status_code).toBe(202);
  });

  it('replays the same key and body (200, same id) and rejects a reused key with a different body (422)', async () => {
    const body = {
      domain: 'diary',
      operation: 'update',
      target: { rowNumber },
      changes: { notes: 'n' },
      reason: 'replay',
      idempotencyKey: `idem-replay-${suffix}`,
    };
    const first = await createProposal(caller, body);
    const again = await createProposal(caller, { ...body });
    const other = await createProposal(caller, { ...body, changes: { notes: 'different' } });
    expect(brief(first.outcome)).toEqual({ ok: true, status: 202, replayed: false });
    expect(brief(again.outcome)).toEqual({ ok: true, status: 200, replayed: true });
    if (!first.outcome.ok || !again.outcome.ok) throw new Error('unreachable');
    expect(again.outcome.proposal.id).toBe(first.outcome.proposal.id);
    expect(brief(other.outcome)).toEqual({ ok: false, status: 422, error: 'idempotency_key_reused' });
  });

  it('M4: the activities snapshot keeps microseconds and before is limited to touched keys', async () => {
    const result = await createProposal(caller, {
      domain: 'schedule',
      operation: 'update',
      target: { id: activityId },
      changes: { notes: '=SUM(A1)', progress: 'Done' },
      reason: 'precision',
      idempotencyKey: `idem-m4-${suffix}`,
    });
    expect(brief(result.outcome)).toEqual({ ok: true, status: 202, replayed: false });
    if (!result.outcome.ok) throw new Error('unreachable');
    expect(result.outcome.proposal.expectedUpdatedAt).toBe('2026-09-01 03:04:05.123456+00');
    expect(result.outcome.proposal.before).toEqual({ notes: 'old notes', progress: '' });
    expect(result.outcome.proposal.warnings).toEqual(['formula_like:notes']);
  });

  it('a delete of an absent diary entry is 404 and inserts nothing', async () => {
    const result = await createProposal(caller, {
      domain: 'diary',
      operation: 'delete',
      target: { rowNumber },
      reason: 'delete absent',
      idempotencyKey: `idem-del-${suffix}`,
    });
    expect(brief(result.outcome)).toEqual({ ok: false, status: 404, error: 'not_found' });
    const rows = await client`select count(*)::int as n from agent_proposals where idempotency_key = ${`idem-del-${suffix}`}`;
    expect(rows[0].n).toBe(0);
  });

  it('a token revoked before the transaction gets 401 and no insert', async () => {
    await db.update(schema.agentTokens).set({ revokedAt: dsql`now()` }).where(eq(schema.agentTokens.id, tokenId));
    try {
      const result = await createProposal(caller, {
        domain: 'diary',
        operation: 'update',
        target: { rowNumber },
        changes: { notes: 'x' },
        reason: 'revoked',
        idempotencyKey: `idem-revoked-${suffix}`,
      });
      expect(brief(result.outcome)).toEqual({ ok: false, status: 401, error: 'invalid_token' });
      const rows = await client`select count(*)::int as n from agent_proposals where idempotency_key = ${`idem-revoked-${suffix}`}`;
      expect(rows[0].n).toBe(0);
    } finally {
      await db.update(schema.agentTokens).set({ revokedAt: null }).where(eq(schema.agentTokens.id, tokenId));
    }
  });

  it('apply SQL runs for every domain and bumps updated_at (rolled back)', async () => {
    const seen: Record<string, unknown> = {};
    let thrown: unknown = null;
    try {
      await db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as AgentTransaction;
        const diaryKey = { rowNumber };
        seen.diaryInsert = await DOMAINS.diary.apply(tx, diaryKey, { learned: 'L' });
        const inserted = await rawTx.select().from(schema.diaryEntries).where(eq(schema.diaryEntries.rowNumber, rowNumber));
        seen.diaryRow = inserted[0];
        seen.diaryUpdate = await DOMAINS.diary.apply(tx, diaryKey, { notes: 'N' });
        seen.diaryDelete = await DOMAINS.diary.apply(tx, diaryKey, 'delete');
        seen.diaryDeleteAgain = await DOMAINS.diary.apply(tx, diaryKey, 'delete');

        seen.schedule = await DOMAINS.schedule.apply(tx, { id: activityId }, { notes: 'new', durationMinutes: 30 });
        const act = await rawTx
          .select({ updatedAt: dsql<string>`${schema.activities.updatedAt}::text` })
          .from(schema.activities)
          .where(eq(schema.activities.id, activityId));
        seen.activityUpdatedAt = act[0].updatedAt;
        seen.scheduleMissing = await DOMAINS.schedule.apply(tx, { id: `${activityId}-missing` }, { notes: 'x' });

        seen.timeline = await DOMAINS.timeline.apply(tx, { stageId }, { completedEvidence: ['b', 'c'] });

        const feedbackKey = { sessionId: 'row-3' };
        await rawTx.delete(schema.feedbackEntries).where(eq(schema.feedbackEntries.sessionId, 'row-3'));
        seen.feedback = await DOMAINS.feedback.apply(tx, feedbackKey, { suggestions: 'S' });
        const fb = await rawTx.select().from(schema.feedbackEntries).where(eq(schema.feedbackEntries.sessionId, 'row-3'));
        seen.feedbackRow = fb[0];

        await rawTx.delete(schema.monthlyReviews).where(eq(schema.monthlyReviews.month, 3));
        seen.reviews = await DOMAINS.reviews.apply(tx, { month: 3 }, { achievements: 'A' });
        seen.reviewsUpdate = await DOMAINS.reviews.apply(tx, { month: 3 }, { valuesRatings: {} });
        throw new Rollback();
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown instanceof Rollback).toBe(true);

    expect(seen.diaryInsert).toEqual({ applied: true, after: { learned: 'L' } });
    expect(pick(seen.diaryRow as Record<string, unknown>, ['id', 'learned', 'notes'])).toEqual({
      id: `entry-${rowNumber}`,
      learned: 'L',
      notes: 'default notes',
    });
    expect(seen.diaryUpdate).toEqual({ applied: true, after: { notes: 'N' } });
    expect(seen.diaryDelete).toEqual({ applied: true, after: null });
    expect(seen.diaryDeleteAgain).toEqual({ applied: false, reason: 'target_missing' });
    expect(seen.schedule).toEqual({ applied: true, after: { notes: 'new', durationMinutes: 30 } });
    expect(seen.activityUpdatedAt).not.toBe('2026-09-01 03:04:05.123456+00');
    expect(seen.scheduleMissing).toEqual({ applied: false, reason: 'target_missing' });
    expect(seen.timeline).toEqual({ applied: true, after: { completedEvidence: ['b', 'c'] } });
    expect(seen.feedback).toEqual({ applied: true, after: { suggestions: 'S' } });
    expect(pick(seen.feedbackRow as Record<string, unknown>, ['id', 'rowNumber', 'pic', 'topic'])).toEqual({
      id: 'fb-row-3',
      rowNumber: 3,
      pic: 'Managing Director',
      topic: 'Introduction to Company',
    });
    expect(seen.reviews).toEqual({ applied: true, after: { achievements: 'A' } });
    expect(seen.reviewsUpdate).toEqual({ applied: true, after: { valuesRatings: {} } });

    const leftover = await client`select count(*)::int as n from diary_entries where row_number = ${rowNumber}`;
    expect(leftover[0].n).toBe(0);
  });
});
