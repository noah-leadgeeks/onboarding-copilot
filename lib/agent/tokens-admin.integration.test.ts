/**
 * Integration test: token issue / list / revoke against a real, LOCAL, already-migrated Postgres.
 * Reads TEST_DATABASE_URL only; refuses any host other than localhost/127.0.0.1. Skipped when unset,
 * except under CI where a missing URL fails (B4). Run in band:
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/ci_test pnpm test --runInBand lib/agent/tokens-admin.integration.test.ts
 *
 * Pool `max: 2` like production (M5). Covers: issue stores only the hash and audits `token.issue`;
 * list never exposes the hash; revoke cancels only the token's pending proposals; and revoke racing
 * `createProposal` (token `FOR SHARE`) never deadlocks and never leaves a pending proposal behind.
 */
import { randomInt } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray, like } from 'drizzle-orm';
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
    throw new Error('CI is set but TEST_DATABASE_URL is missing; the token admin integration test must not be skipped in CI.');
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
const { issueAgentToken, listAgentTokens, revokeAgentToken, listAuditRows } = require('./tokens-admin') as typeof import('./tokens-admin');
const { hashAgentToken } = require('./tokens') as typeof import('./tokens');

const OWNER = 'owner@example.com';
const RACE_ITERATIONS = 20;
const STEP_TIMEOUT_MS = 15_000;

jest.setTimeout(120_000);

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${STEP_TIMEOUT_MS} ms (deadlock?)`)), STEP_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

describeWithDb('agent token admin (integration, TEST_DATABASE_URL)', () => {
  let client: postgres.Sql;
  let db: Db;
  const suffix = `${randomInt(0, 1e9)}_${Date.now()}`;
  const tokenIds: string[] = [];
  const rowNumber = 700_000 + randomInt(0, 90_000);
  let idemSeq = 0;

  async function issue(name: string, scopes: Parameters<typeof issueAgentToken>[1]['scopes'] = ['diary:propose']) {
    const issued = await issueAgentToken(db, { name: `${name}-${suffix}`, scopes }, OWNER, { path: '/api/agent-admin/tokens' });
    tokenIds.push(issued.view.id);
    return issued;
  }

  async function propose(tokenId: string) {
    idemSeq += 1;
    return createProposal(
      { tokenId, scopes: ['diary:propose'] },
      { domain: 'diary', operation: 'update', target: { rowNumber }, changes: { learned: `x${idemSeq}` }, reason: 'it', idempotencyKey: `idem-tok-${suffix}-${idemSeq}` }
    );
  }

  beforeAll(async () => {
    const url = testDatabaseUrl as string;
    client = postgres(url, { max: 2, ssl: resolveSslOption(url), onnotice: () => {} });
    db = drizzle(client, { schema });
    mockDb = db;
    await db.insert(schema.diaryTopics).values({
      id: `topic_tok_it_${suffix}`,
      rowNumber,
      day: 'Monday',
      week: 'Week 1',
      date: '01/09/2026',
      pic: 'HR',
      topic: 'Token admin integration topic',
    });
  });

  afterAll(async () => {
    if (db) {
      if (tokenIds.length > 0) {
        await db.delete(schema.agentAuditLog).where(inArray(schema.agentAuditLog.tokenId, tokenIds));
        await db.delete(schema.agentProposals).where(inArray(schema.agentProposals.tokenId, tokenIds));
        await db.delete(schema.agentTokens).where(inArray(schema.agentTokens.id, tokenIds));
      }
      await db.delete(schema.diaryEntries).where(eq(schema.diaryEntries.rowNumber, rowNumber));
      await db.delete(schema.diaryTopics).where(like(schema.diaryTopics.id, `topic_tok_it_${suffix}`));
    }
    mockDb = null;
    await client?.end();
  });

  it('issue stores only the sha256 hash, sets the default expiry, and audits token.issue without the plaintext', async () => {
    const issued = await issue('issue', ['diary:read', 'schedule:read']);
    const stored = await client`select token_hash, token_prefix, scopes, created_by, expires_at - created_at as ttl from agent_tokens where id = ${issued.view.id}`;
    expect(stored[0].token_hash).toBe(hashAgentToken(issued.token));
    expect(stored[0].token_prefix).toBe(issued.token.slice(0, 17));
    expect(stored[0].scopes).toEqual(['diary:read', 'schedule:read']);
    expect(stored[0].created_by).toBe(OWNER);
    expect(String(stored[0].ttl)).toMatch(/^90 days/);

    const audit = await listAuditRows(db, { tokenId: issued.view.id });
    expect(audit.map((r) => [r.action, r.actor, r.statusCode, r.userEmail])).toEqual([['token.issue', 'user', 201, OWNER]]);
    expect(JSON.stringify(audit)).not.toContain(issued.token);

    const listed = await listAgentTokens(db);
    const mine = listed.find((t) => t.id === issued.view.id);
    expect([mine?.prefix, mine?.revokedAt, mine?.lastUsedAt]).toEqual([issued.token.slice(0, 17), null, null]);
    expect(JSON.stringify(listed)).not.toContain(stored[0].token_hash as string);
  });

  it('revoke cancels only this token\'s pending proposals; a second revoke is already_revoked', async () => {
    const a = await issue('revoke-a');
    const b = await issue('revoke-b');
    const pa = await propose(a.view.id);
    const pb = await propose(b.view.id);
    if (!pa.outcome.ok || !pb.outcome.ok) throw new Error('setup proposals failed');

    const result = await withTimeout(revokeAgentToken(db, a.view.id, OWNER, { path: '/api/agent-admin/tokens/x/revoke' }), 'revoke');
    expect(result).toEqual({ status: 'revoked', cancelledProposalIds: [pa.outcome.proposal.id] });
    const statuses = await client`select id, status, decided_by from agent_proposals where id in ${client([pa.outcome.proposal.id, pb.outcome.proposal.id])} order by id`;
    const byId = Object.fromEntries(statuses.map((r) => [r.id, [r.status, r.decided_by]]));
    expect(byId[pa.outcome.proposal.id]).toEqual(['cancelled', OWNER]);
    expect(byId[pb.outcome.proposal.id]).toEqual(['pending', null]);
    expect(await revokeAgentToken(db, a.view.id, OWNER)).toEqual({ status: 'already_revoked' });
    expect(await revokeAgentToken(db, `tok_missing_${suffix}`, OWNER)).toEqual({ status: 'not_found' });

    const audit = await listAuditRows(db, { tokenId: a.view.id });
    const revokeRow = audit.find((r) => r.action === 'token.revoke');
    expect([revokeRow?.statusCode, revokeRow?.details]).toEqual([200, { cancelled: 1 }]);

    const after = await propose(a.view.id);
    expect(after.outcome.ok ? 'created' : after.outcome.status).toBe(401);
  });

  it(`revoke racing createProposal (token FOR SHARE) never deadlocks and never leaves a pending proposal (${RACE_ITERATIONS} runs)`, async () => {
    const tally = { createdThenCancelled: 0, refused: 0 };
    for (let i = 0; i < RACE_ITERATIONS; i += 1) {
      const token = await issue(`race-${i}`);
      const lag = i % 4;
      const later = <T,>(fn: () => Promise<T>): Promise<T> => new Promise((resolve) => setTimeout(resolve, lag)).then(fn);
      const [created, revoked] = await withTimeout(
        i % 2 === 0
          ? Promise.all([propose(token.view.id), later(() => revokeAgentToken(db, token.view.id, OWNER))])
          : Promise.all([later(() => propose(token.view.id)), revokeAgentToken(db, token.view.id, OWNER)]),
        `revoke-vs-propose run ${i}`
      );
      expect(revoked.status).toBe('revoked');
      const pending = await client`select count(*)::int as n from agent_proposals where token_id = ${token.view.id} and status = 'pending'`;
      expect(pending[0].n).toBe(0);
      if (created.outcome.ok) {
        tally.createdThenCancelled += 1;
        expect(revoked.status === 'revoked' && revoked.cancelledProposalIds).toEqual([created.outcome.proposal.id]);
      } else {
        tally.refused += 1;
        expect(created.outcome.status).toBe(401);
      }
    }
    process.stdout.write(`[tokens-admin.integration] revoke-vs-propose over ${RACE_ITERATIONS} runs: created+cancelled=${tally.createdThenCancelled} refused=${tally.refused}\n`);
  });
});
