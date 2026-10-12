import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { buildBaselineSql } from './baseline-sql';

const MIGRATIONS_FOLDER = path.join(__dirname, '..', '..', 'drizzle');

interface JournalEntry {
  tag: string;
  when: number;
}

function readJournal(): JournalEntry[] {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

function insertLines(sql: string): string[] {
  return sql.split('\n').filter((line) => line.startsWith('INSERT INTO drizzle.__drizzle_migrations'));
}

describe('buildBaselineSql (real drizzle/ folder)', () => {
  const sql = buildBaselineSql(readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }));
  const journal = readJournal();

  it('wraps everything in one transaction', () => {
    const statements = sql.split('\n').filter((line) => line !== '' && !line.startsWith('--'));
    expect(statements[0]).toBe('BEGIN;');
    expect(statements[statements.length - 1]).toBe('COMMIT;');
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
  });

  it('creates the drizzle schema and table idempotently with drizzle-orm DDL', () => {
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS drizzle;');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);',
    );
  });

  it('emits exactly one guarded INSERT, for 0000_baseline, with the file sha256 and the journal `when`', () => {
    const inserts = insertLines(sql);
    expect(journal.length).toBeGreaterThan(0);
    expect(journal[0].tag).toBe('0000_baseline');
    expect(inserts).toHaveLength(1);
    const raw = fs.readFileSync(path.join(MIGRATIONS_FOLDER, `${journal[0].tag}.sql`));
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    expect(inserts[0]).toBe(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '${hash}', ${journal[0].when} ` +
        `WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= ${journal[0].when});`,
    );
  });

  it('emits no row for later journal entries (their DDL must still run)', () => {
    journal.slice(1).forEach((entry) => {
      expect(sql).not.toContain(String(entry.when));
    });
  });

  it('contains no destructive statements', () => {
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i);
  });
});

describe('buildBaselineSql (validation)', () => {
  const good = { hash: 'a'.repeat(64), folderMillis: 1700000000000 };

  it('guards the INSERT so a second run inserts nothing, and ignores later entries', () => {
    const sql = buildBaselineSql([good, { hash: 'b'.repeat(64), folderMillis: 1700000000001 }]);
    const inserts = insertLines(sql);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain('WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE created_at >= 1700000000000)');
    expect(sql).not.toContain('1700000000001');
  });

  it('rejects an empty journal', () => {
    expect(() => buildBaselineSql([])).toThrow('No migrations');
  });

  const badHashes: Array<[string, string]> = [
    ['uppercase', 'A'.repeat(64)],
    ['short', 'a'.repeat(63)],
    ['quote injection', `${'a'.repeat(60)}'; --`],
  ];
  for (const [label, hash] of badHashes) {
    it(`rejects a ${label} hash`, () => {
      expect(() => buildBaselineSql([{ ...good, hash }])).toThrow('#1: hash is not a sha256 hex digest');
    });
  }

  const badMillis: Array<[string, number]> = [
    ['fractional', 1.5],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['unsafe', Number.MAX_SAFE_INTEGER + 1],
  ];
  for (const [label, folderMillis] of badMillis) {
    it(`rejects a ${label} folderMillis`, () => {
      expect(() => buildBaselineSql([{ ...good, folderMillis }])).toThrow('#1: folderMillis');
    });
  }
});
