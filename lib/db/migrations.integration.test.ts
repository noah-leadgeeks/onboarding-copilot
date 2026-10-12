/**
 * Integration test: applies drizzle/ to a real, LOCAL Postgres and round-trips one row.
 *
 * Reads TEST_DATABASE_URL only (never DATABASE_URL). Skipped when it is unset, except under CI
 * (process.env.CI set), where a missing URL FAILS the run. Any host other
 * than localhost / 127.0.0.1 is refused at module load, before a client is created.
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/ci_test pnpm test lib/db/migrations.integration.test.ts
 */
import path from 'path';
import { randomInt } from 'crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { resolveSslOption } from './ssl';

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
    throw new Error(
      `TEST_DATABASE_URL host "${hostname}" is not localhost or 127.0.0.1; refusing to connect.`,
    );
  }
}

const migrationsFolder = path.join(__dirname, '..', '..', 'drizzle');
// lib/test-globals.d.ts narrows `describe` to a plain function, so reach jest's typed global for .skip.
const jestDescribe = (globalThis as unknown as { describe: jest.Describe }).describe;
const missingUrlInCi = testDatabaseUrl === undefined && Boolean(process.env.CI);
const describeWithDb = testDatabaseUrl === undefined ? jestDescribe.skip : jestDescribe;

if (missingUrlInCi) {
  // Skipping silently in CI would hide a broken migration; fail loudly instead.
  it('requires TEST_DATABASE_URL when CI is set', () => {
    throw new Error('CI is set but TEST_DATABASE_URL is missing; the migration integration test must not be skipped in CI.');
  });
}

describeWithDb('drizzle migrations (integration, TEST_DATABASE_URL)', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    const url = testDatabaseUrl as string;
    sql = postgres(url, { max: 1, ssl: resolveSslOption(url), onnotice: () => {} });
    await migrate(drizzle(sql), { migrationsFolder });
  });

  afterAll(async () => {
    await sql?.end();
  });

  it('applies every migration and records exactly one row per journal entry', async () => {
    const journalEntries = readMigrationFiles({ migrationsFolder }).length;
    expect(journalEntries).toBe(2);

    // beforeAll already migrated; a second run on a migrated database must be a no-op.
    await migrate(drizzle(sql), { migrationsFolder });

    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
    expect(count).toBe(journalEntries);
  });

  describe('agent access schema (0001_agent_access)', () => {
    const uid = () => `it-${randomInt(0, 1e9)}-${Date.now()}`;
    const tokenIds: string[] = [];

    /** Resolves to the rejection message, or '' when the promise fulfilled (lib/test-globals.d.ts has no .rejects). */
    async function failure(p: PromiseLike<unknown>): Promise<string> {
      try {
        await p;
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }

    async function insertToken(scopes: unknown = ['read']): Promise<string> {
      const id = uid();
      tokenIds.push(id);
      await sql`
        INSERT INTO agent_tokens (id, name, token_prefix, token_hash, scopes, created_by)
        VALUES (${id}, ${'t'}, ${'pre'}, ${`hash-${id}`}, ${JSON.stringify(scopes)}::jsonb, ${'tester'})`;
      return id;
    }

    async function insertProposal(
      tokenId: string,
      o: { status?: string; operation?: string; idem?: string; ratingsSource?: string | null } = {},
    ): Promise<void> {
      await sql`
        INSERT INTO agent_proposals
          (id, token_id, domain, operation, target_table, target_key, changes, reason,
           idempotency_key, body_hash, status, expires_at, ratings_source)
        VALUES (${uid()}, ${tokenId}, ${'diary'}, ${o.operation ?? 'update'}, ${'diary_entries'},
                ${JSON.stringify({ id: 'x' })}::jsonb, ${JSON.stringify({ a: 1 })}::jsonb, ${'r'},
                ${o.idem ?? uid()}, ${'bh'}, ${o.status ?? 'pending'}, now() + interval '1 day',
                ${o.ratingsSource === undefined ? null : o.ratingsSource})`;
    }

    afterAll(async () => {
      for (const id of tokenIds) {
        await sql`DELETE FROM agent_audit_log WHERE token_id = ${id}`;
        await sql`DELETE FROM agent_proposals WHERE token_id = ${id}`;
        await sql`DELETE FROM agent_tokens WHERE id = ${id}`;
      }
    });

    it('creates the three tables', async () => {
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('agent_tokens', 'agent_proposals', 'agent_audit_log')
        ORDER BY table_name`;
      expect(rows.map((r) => r.table_name)).toEqual(['agent_audit_log', 'agent_proposals', 'agent_tokens']);
    });

    it('has UNIQUE (token_id, idempotency_key) and rejects a duplicate', async () => {
      const [row] = await sql<{ def: string }[]>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'agent_proposals_token_idem_uq' AND conrelid = 'agent_proposals'::regclass`;
      expect(row.def).toBe('UNIQUE (token_id, idempotency_key)');

      const token = await insertToken();
      await insertProposal(token, { idem: 'dup' });
      expect(await failure(insertProposal(token, { idem: 'dup' }))).toMatch(/./);
    });

    it('keeps before and expected_updated_at nullable', async () => {
      const rows = await sql<{ column_name: string; is_nullable: string }[]>`
        SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'agent_proposals'
          AND column_name IN ('before', 'expected_updated_at')`;
      expect(rows).toHaveLength(2);
      rows.forEach((r) => expect(r.is_nullable).toBe('YES'));
    });

    it('rejects an invalid proposal status and operation', async () => {
      const token = await insertToken();
      expect(await failure(insertProposal(token, { status: 'bogus' }))).toMatch(/agent_proposals_status_chk/);
      expect(await failure(insertProposal(token, { operation: 'insert' }))).toMatch(/agent_proposals_operation_chk/);
      expect(await failure(insertProposal(token, { status: 'executed' }))).toBe('');
    });

    it('rejects an invalid audit-log actor', async () => {
      const bad = await failure(
        sql`INSERT INTO agent_audit_log (id, actor, action) VALUES (${uid()}, ${'robot'}, ${'x'})`,
      );
      expect(bad).toMatch(/agent_audit_log_actor_chk/);
      const id = uid();
      await sql`INSERT INTO agent_audit_log (id, actor, action) VALUES (${id}, ${'agent'}, ${'x'})`;
      await sql`DELETE FROM agent_audit_log WHERE id = ${id}`;
    });

    it('rejects non-array token scopes', async () => {
      expect(await failure(insertToken({ read: true }))).toMatch(/agent_tokens_scopes_array_chk/);
      expect(await failure(insertToken('read'))).toMatch(/agent_tokens_scopes_array_chk/);
    });

    it('accepts ratings_source NULL and user-dictated, rejects other', async () => {
      const token = await insertToken();
      expect(await failure(insertProposal(token, { ratingsSource: null }))).toBe('');
      expect(await failure(insertProposal(token, { ratingsSource: 'user-dictated' }))).toBe('');
      expect(await failure(insertProposal(token, { ratingsSource: 'other' }))).toMatch(
        /agent_proposals_ratings_source_chk/,
      );
    });
  });

  it('inserts, selects and deletes a diary_entries row', async () => {
    const rowNumber = 9000 + randomInt(0, 1000);
    const id = `entry-integration-${rowNumber}`;
    try {
      await sql`
        INSERT INTO diary_entries (id, row_number, learned, notes, updated_at)
        VALUES (${id}, ${rowNumber}, ${'learned text'}, ${''}, ${new Date().toISOString()})`;

      const rows = await sql<{ id: string; row_number: number; learned: string; notes: string }[]>`
        SELECT id, row_number, learned, notes FROM diary_entries WHERE row_number = ${rowNumber}`;
      expect(rows).toEqual([{ id, row_number: rowNumber, learned: 'learned text', notes: '' }]);
    } finally {
      await sql`DELETE FROM diary_entries WHERE id = ${id}`;
    }

    const after = await sql`SELECT 1 FROM diary_entries WHERE id = ${id}`;
    expect(after).toHaveLength(0);
  });
});
