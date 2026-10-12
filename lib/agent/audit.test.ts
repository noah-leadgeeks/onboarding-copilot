import { PgTransaction } from 'drizzle-orm/pg-core';
import { recordAudit, sanitizeAuditPath, updateAudit, type AgentExecutor } from './audit';
import { createFakeAgentDb, pgError, type FakeAgentDb } from './testing/fake-db';

interface DrizzleInternals {
  dialect: ConstructorParameters<typeof PgTransaction>[0];
  session: ConstructorParameters<typeof PgTransaction>[1];
}

/**
 * Mimics PostgresJsTransaction: `transaction()` opens a savepoint, releases it on success and rolls
 * back to it on failure (re-throwing), exactly like postgres-js `sql.savepoint`.
 */
function createFakeTx(fake: FakeAgentDb, log: string[]): AgentExecutor {
  const { dialect, session } = fake.db as unknown as DrizzleInternals;
  class FakeTx extends PgTransaction<never, Record<string, never>, Record<string, never>> {
    async transaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
      log.push('savepoint');
      try {
        const result = await fn(new FakeTx(dialect, session, undefined));
        log.push('release savepoint');
        return result;
      } catch (error) {
        log.push('rollback to savepoint');
        throw error;
      }
    }
  }
  return new FakeTx(dialect, session, undefined) as unknown as AgentExecutor;
}

describe('lib/agent/audit', () => {
  let fake: FakeAgentDb;

  beforeEach(() => {
    fake = createFakeAgentDb();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inserts directly on db (no savepoint) and returns the id', async () => {
    const result = await recordAudit(fake.db as unknown as AgentExecutor, {
      actor: 'user',
      action: 'approve',
      userEmail: 'owner@example.com',
      path: 'https://host.example/api/agent-admin/proposals/p1/approve?x=1#frag',
      statusCode: 200,
    });
    expect(result.ok).toBe(true);
    expect(fake.audit).toHaveLength(1);
    expect(fake.audit[0].path).toBe('/api/agent-admin/proposals/p1/approve');
    expect(fake.audit[0].actor).toBe('user');
    expect(fake.queries.some((q) => /savepoint/i.test(q.sql))).toBe(false);
  });

  it('runs the insert inside a savepoint when given a tx', async () => {
    const log: string[] = [];
    const tx = createFakeTx(fake, log);
    const result = await recordAudit(tx, { actor: 'user', action: 'reject', statusCode: 200 });
    expect(result.ok).toBe(true);
    expect(log).toEqual(['savepoint', 'release savepoint']);
    expect(fake.audit).toHaveLength(1);
  });

  it('never throws: an FK violation inside a tx rolls back only the savepoint and is returned', async () => {
    const log: string[] = [];
    const tx = createFakeTx(fake, log);
    fake.failWith = (q) => (q.sql.startsWith('insert into "agent_audit_log"') ? pgError('23503') : undefined);
    const result = await recordAudit(tx, { actor: 'user', action: 'approve', proposalId: 'missing' });
    expect(result.ok).toBe(false);
    expect(log).toEqual(['savepoint', 'rollback to savepoint']);
    expect(fake.audit).toHaveLength(0);
  });

  it('never throws on db either, and updateAudit never throws', async () => {
    fake.failWith = () => pgError('08006');
    const inserted = await recordAudit(fake.db as unknown as AgentExecutor, { actor: 'system', action: 'x' });
    expect(inserted.ok).toBe(false);
    const updated = await updateAudit(fake.db as unknown as AgentExecutor, 'aud_1', { statusCode: 200 });
    expect(updated.ok).toBe(false);
  });

  it('does not log the error message (drizzle messages include query params)', async () => {
    const warn = console.warn as unknown as jest.Mock;
    fake.failWith = () => pgError('23514', 'value nova_agt_SECRET violates check');
    await recordAudit(fake.db as unknown as AgentExecutor, { actor: 'agent', action: 'read.diary' });
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('23514');
    expect(logged.includes('nova_agt_SECRET')).toBe(false);
  });

  it('sanitizes token_prefix, path and details', async () => {
    await recordAudit(fake.db as unknown as AgentExecutor, {
      actor: 'agent',
      action: 'auth.failed',
      tokenPrefix: 'nova_agt_ab-cd/ef$ghijklmnop',
      path: '/api/agent/v1/nova_agt_AAAABBBB/x?token=nova_agt_zzz',
      details: { reason: 'see nova_agt_QQQQ', fields: ['a', 'nova_agt_R'] },
    });
    const row = fake.audit[0];
    expect(row.token_prefix).toBe('nova_agt_abcdef');
    expect(row.path).toBe('/api/agent/v1/[redacted]/x');
    expect(row.details).toEqual({ reason: 'see [redacted]', fields: ['a', '[redacted]'] });
  });

  it('sanitizeAuditPath keeps only the pathname', () => {
    expect(sanitizeAuditPath('/api/agent/v1/diary?rowNumber=1')).toBe('/api/agent/v1/diary');
    expect(sanitizeAuditPath('http://localhost/api/agent/v1/me#x')).toBe('/api/agent/v1/me');
    expect(sanitizeAuditPath('')).toBeNull();
    expect(sanitizeAuditPath(null)).toBeNull();
    expect(String(sanitizeAuditPath(`/${'a'.repeat(2000)}`)).length).toBe(512);
  });
});
