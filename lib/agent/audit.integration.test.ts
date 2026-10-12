/**
 * Integration test: recordAudit savepoint behaviour and rate-limit counts against a real, LOCAL,
 * already-migrated Postgres. Reads TEST_DATABASE_URL only (never DATABASE_URL); refuses any host
 * other than localhost/127.0.0.1. Skipped when unset, except under CI where a missing URL fails.
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/ci_test pnpm test lib/agent/audit.integration.test.ts
 */
import { randomInt } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray, sql as dsql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { resolveSslOption } from '@/lib/db/ssl';
import { recordAudit, type AgentExecutor } from './audit';
import { countRecentAgentActions, countRecentAuthFailures } from './rate-limit';

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

// lib/test-globals.d.ts narrows `describe` to a plain function, so reach jest's typed global for .skip.
const jestDescribe = (globalThis as unknown as { describe: jest.Describe }).describe;
const describeWithDb = testDatabaseUrl === undefined ? jestDescribe.skip : jestDescribe;

if (testDatabaseUrl === undefined && Boolean(process.env.CI)) {
  it('requires TEST_DATABASE_URL when CI is set', () => {
    throw new Error('CI is set but TEST_DATABASE_URL is missing; the agent audit integration test must not be skipped in CI.');
  });
}

describeWithDb('agent audit + rate limit (integration, TEST_DATABASE_URL)', () => {
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const tokenId = `tok_it_${randomInt(0, 1e9)}_${Date.now()}`;
  const otherTokenId = `${tokenId}_other`;

  beforeAll(async () => {
    const url = testDatabaseUrl as string;
    client = postgres(url, { max: 2, ssl: resolveSslOption(url), onnotice: () => {} });
    db = drizzle(client, { schema });
    for (const id of [tokenId, otherTokenId]) {
      await db.insert(schema.agentTokens).values({
        id,
        name: 'integration',
        tokenPrefix: 'nova_agt_test0000',
        tokenHash: `hash_${id}`,
        scopes: ['diary:read'],
        createdBy: 'integration-test',
      });
    }
  });

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (db) {
      await db.delete(schema.agentAuditLog).where(inArray(schema.agentAuditLog.tokenId, [tokenId, otherTokenId]));
      await db.delete(schema.agentAuditLog).where(eq(schema.agentAuditLog.userEmail, tokenId));
      await db.delete(schema.agentTokens).where(inArray(schema.agentTokens.id, [tokenId, otherTokenId]));
    }
    await client?.end();
  });

  it('control: without a savepoint an FK violation aborts the outer transaction (25P02)', async () => {
    let code: unknown = null;
    try {
      await db.transaction(async (tx) => {
        try {
          await tx.insert(schema.agentAuditLog).values({ id: `aud_ctl_${tokenId}`, actor: 'user', action: 'approve', proposalId: 'missing' });
        } catch {
          // swallow, like a naive "never throws" helper would
        }
        await tx.execute(dsql`select 1`);
      });
    } catch (error) {
      code = (error as { code?: unknown; cause?: { code?: unknown } }).cause?.code ?? (error as { code?: unknown }).code;
    }
    expect(code).toBe('25P02');
  });

  it('recordAudit(tx) with an FK violation returns ok:false and leaves the transaction usable', async () => {
    const outcome = await db.transaction(async (tx) => {
      const bad = await recordAudit(tx as unknown as AgentExecutor, {
        actor: 'user',
        action: 'approve',
        userEmail: tokenId,
        proposalId: 'does-not-exist',
      });
      const ping = await tx.execute(dsql`select 1 as one`);
      const good = await recordAudit(tx as unknown as AgentExecutor, { actor: 'user', action: 'reject', userEmail: tokenId, statusCode: 200 });
      return { bad, good, pingRows: ping.length };
    });
    expect(outcome.bad.ok).toBe(false);
    expect(outcome.good.ok).toBe(true);
    expect(outcome.pingRows).toBe(1);
    const rows = await db.select().from(schema.agentAuditLog).where(eq(schema.agentAuditLog.userEmail, tokenId));
    expect(rows.map((r) => r.action)).toEqual(['reject']);
  });

  it('recordAudit(tx) with a CHECK violation (bad actor) also leaves the transaction usable', async () => {
    const ok = await db.transaction(async (tx) => {
      const bad = await recordAudit(tx as unknown as AgentExecutor, {
        actor: 'robot' as unknown as 'agent',
        action: 'x',
        userEmail: tokenId,
      });
      await tx.execute(dsql`select 1`);
      return bad.ok;
    });
    expect(ok).toBe(false);
  });

  it('counts read and proposal classes in the last minute, excluding rate_limited/auth.failed', async () => {
    const add = async (action: string, opts: { tokenId?: string; actor?: 'agent' | 'user'; old?: boolean } = {}) => {
      const id = `aud_it_${randomInt(0, 1e9)}_${Date.now()}`;
      await db.insert(schema.agentAuditLog).values({
        id,
        actor: opts.actor ?? 'agent',
        action,
        tokenId: opts.tokenId ?? tokenId,
        ...(opts.old ? { createdAt: dsql`now() - interval '2 minutes'` as unknown as Date } : {}),
      });
    };
    await add('read.diary');
    await add('read.schedule');
    await add('read.proposals');
    await add('read.diary', { old: true });
    await add('read.diary', { tokenId: otherTokenId });
    await add('read.diary', { actor: 'user' });
    await add('propose.diary.update');
    await add('propose.feedback.delete');
    await add('cancel');
    await add('propose.diary.update', { old: true });
    await add('rate_limited');
    await add('rate_limited');
    await add('auth.failed');
    await add('insufficient_scope');
    await add('approve');

    expect(await countRecentAgentActions(db as unknown as AgentExecutor, tokenId, 'read')).toBe(3);
    expect(await countRecentAgentActions(db as unknown as AgentExecutor, tokenId, 'proposal')).toBe(3);
  });

  it('counts auth.failed rows in the last minute across tokens', async () => {
    const before = await countRecentAuthFailures(db as unknown as AgentExecutor);
    await db.insert(schema.agentAuditLog).values({ id: `aud_af_${tokenId}_1`, actor: 'agent', action: 'auth.failed', tokenId: otherTokenId });
    await db.insert(schema.agentAuditLog).values({
      id: `aud_af_${tokenId}_2`,
      actor: 'agent',
      action: 'auth.failed',
      tokenId: otherTokenId,
      createdAt: dsql`now() - interval '5 minutes'` as unknown as Date,
    });
    expect(await countRecentAuthFailures(db as unknown as AgentExecutor)).toBe(before + 1);
  });
});
