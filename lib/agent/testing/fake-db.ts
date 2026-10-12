/**
 * Test-only in-memory stand-in for the agent tables, built on drizzle's pg-proxy driver so the real
 * query builders run and their SQL text can be asserted. It interprets only the statements issued
 * by lib/agent (token lookup, last_used_at update, audit insert/update, audit counts) plus, via
 * `tables` (see fake-tables.ts), `agent_proposals` and any domain table a test seeds.
 * `db.transaction(fn)` runs `fn(db)` and restores `tables` if it throws (rollback).
 * Time windows are not emulated: every audit row counts as "within the last minute".
 */
import { drizzle } from 'drizzle-orm/pg-proxy';
import * as schema from '@/lib/db/schema';
import { cloneTables, runFakeTableQuery, type FakeTables } from './fake-tables';

export interface FakeQuery {
  sql: string;
  params: unknown[];
  method: string;
}

export interface FakeToken {
  id: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  scopes: unknown;
  expiresAt: string | null;
  revoked: boolean;
  expired: boolean;
}

export type FakeAuditRow = Record<string, unknown>;

export type FailureInjector = (query: FakeQuery) => unknown | undefined;

export interface FakeAgentDb {
  db: ReturnType<typeof drizzle<typeof schema>>;
  queries: FakeQuery[];
  tokens: FakeToken[];
  audit: FakeAuditRow[];
  lastUsedUpdates: string[];
  /** Return an error object to make the matching query throw it (drizzle wraps it as `cause`). */
  failWith: FailureInjector | null;
  /**
   * Answers queries on non-agent tables (read-endpoint tests). Return positional rows (arrays in
   * selection order, see `positionalRows`) or undefined to fall through to "unexpected query".
   */
  data: DataHandler | null;
  /** Rows by SQL table name (driver format, SQL column names). `agent_proposals` always exists. */
  tables: FakeTables;
}

export type DataHandler = (query: FakeQuery) => unknown[][] | undefined;

/**
 * Converts objects to the positional rows the pg-proxy driver expects, in the key order of a
 * selection object or of `getTableColumns(table)` (drizzle's order for `select()` without fields).
 */
export function positionalRows(selection: Record<string, unknown>, objects: ReadonlyArray<Record<string, unknown>>): unknown[][] {
  const keys = Object.keys(selection);
  return objects.map((object) => keys.map((key) => (key in object ? object[key] : null)));
}

export function pgError(code: string, message = 'simulated postgres error'): Error {
  return Object.assign(new Error(message), { code });
}

function unquote(identifier: string): string {
  return identifier.trim().replace(/^"|"$/g, '');
}

function resolveValue(token: string, params: unknown[]): unknown {
  const trimmed = token.trim();
  const match = /^\$(\d+)$/.exec(trimmed);
  if (match) return params[Number(match[1]) - 1];
  if (trimmed === 'default') return undefined;
  if (trimmed === 'null') return null;
  return trimmed;
}

function parseInsert(sqlText: string, params: unknown[]): FakeAuditRow {
  const match = /insert into "agent_audit_log" \(([^)]*)\) values \(([^]*)\)$/.exec(sqlText);
  if (!match) throw new Error(`fake-db: cannot parse insert: ${sqlText}`);
  const columns = match[1].split(',').map(unquote);
  const values = match[2].split(',').map((v) => resolveValue(v, params));
  const row: FakeAuditRow = {};
  columns.forEach((column, index) => {
    const value = values[index];
    if (value !== undefined) row[column] = typeof value === 'string' && column === 'details' ? JSON.parse(value) : value;
  });
  return row;
}

function parseUpdate(sqlText: string, params: unknown[]): { set: FakeAuditRow; id: unknown } {
  const match = /update "agent_audit_log" set ([^]*) where "agent_audit_log"\."id" = (\$\d+)/.exec(sqlText);
  if (!match) throw new Error(`fake-db: cannot parse update: ${sqlText}`);
  const set: FakeAuditRow = {};
  for (const pair of match[1].split(/,\s*(?=")/)) {
    const [column, value] = pair.split(' = ');
    const resolved = resolveValue(value, params);
    set[unquote(column)] = typeof resolved === 'string' && unquote(column) === 'details' ? JSON.parse(resolved) : resolved;
  }
  return { set, id: resolveValue(match[2], params) };
}

function countRateRows(sqlText: string, params: unknown[], audit: FakeAuditRow[]): number {
  const tokenId = params[0];
  const isRead = sqlText.includes(`"agent_audit_log"."action" LIKE 'read.%'`);
  const isProposal = sqlText.includes(
    `("agent_audit_log"."action" LIKE 'propose.%' OR "agent_audit_log"."action" = 'cancel')`
  );
  if (!sqlText.includes(`"agent_audit_log"."action" NOT IN ('rate_limited', 'auth.failed')`)) {
    throw new Error('fake-db: rate-limit count is missing the rate_limited/auth.failed exclusion');
  }
  if (isRead === isProposal) throw new Error('fake-db: rate-limit count has no single class predicate');
  return audit.filter((row) => {
    const action = String(row.action);
    if (row.token_id !== tokenId || row.actor !== 'agent') return false;
    if (action === 'rate_limited' || action === 'auth.failed') return false;
    return isRead ? action.startsWith('read.') : action.startsWith('propose.') || action === 'cancel';
  }).length;
}

export function createFakeAgentDb(): FakeAgentDb {
  const state: FakeAgentDb = {
    db: undefined as unknown as FakeAgentDb['db'],
    queries: [],
    tokens: [],
    audit: [],
    lastUsedUpdates: [],
    failWith: null,
    data: null,
    tables: { agent_proposals: [] },
  };

  state.db = drizzle(
    async (sqlText, params, method) => {
      const query: FakeQuery = { sql: sqlText, params, method };
      state.queries.push(query);
      const injected = state.failWith?.(query);
      if (injected) throw injected;

      if (sqlText.startsWith('select') && sqlText.includes('from "agent_tokens"') && sqlText.endsWith(' for share')) {
        // createProposal's in-transaction liveness check: by id, not revoked (M7).
        const token = state.tokens.find((t) => t.id === params[0] && !t.revoked);
        return { rows: token ? [[token.id]] : [] };
      }
      if (
        sqlText.startsWith('select "revoked_at" from "agent_tokens"') &&
        sqlText.includes('where "agent_tokens"."id" = $1')
      ) {
        // approveProposal's plain (unlocked) revocation read by token id (M7).
        const token = state.tokens.find((t) => t.id === params[0]);
        return { rows: token ? [[token.revoked ? '2026-01-01 00:00:00+00' : null]] : [] };
      }
      if (sqlText.startsWith('select') && sqlText.includes('from "agent_tokens"')) {
        const token = state.tokens.find((t) => t.tokenHash === params[0]);
        if (!token) return { rows: [] };
        // Order matches TOKEN_AUTH_SELECTION in lib/agent/auth.ts.
        return {
          rows: [[token.id, token.name, token.tokenPrefix, token.scopes, token.expiresAt, token.revoked, token.expired]],
        };
      }
      if (sqlText.startsWith('update "agent_tokens" set "last_used_at"')) {
        state.lastUsedUpdates.push(String(params[0]));
        return { rows: [] };
      }
      if (sqlText.startsWith('insert into "agent_audit_log"')) {
        state.audit.push(parseInsert(sqlText, params));
        return { rows: [] };
      }
      if (sqlText.startsWith('update "agent_audit_log"')) {
        const { set, id } = parseUpdate(sqlText, params);
        const row = state.audit.find((r) => r.id === id);
        if (row) Object.assign(row, set);
        return { rows: [] };
      }
      if (sqlText.startsWith('select count(*)::int from "agent_audit_log"')) {
        if (sqlText.includes(`"agent_audit_log"."action" = $1`) && params[0] === 'auth.failed') {
          return { rows: [[state.audit.filter((r) => r.action === 'auth.failed').length]] };
        }
        return { rows: [[countRateRows(sqlText, params, state.audit)]] };
      }
      const tableRows = runFakeTableQuery(state.tables, sqlText, params);
      if (tableRows) return { rows: tableRows };
      const answered = state.data?.(query);
      if (answered) return { rows: answered };
      throw new Error(`fake-db: unexpected query: ${sqlText}`);
    },
    { schema }
  );

  // pg-proxy has no transactions; emulate one on the same fake (rollback restores `tables`).
  Object.defineProperty(state.db, 'transaction', {
    configurable: true,
    value: async <T>(fn: (tx: FakeAgentDb['db']) => Promise<T>): Promise<T> => {
      const saved = cloneTables(state.tables);
      state.queries.push({ sql: 'begin', params: [], method: 'execute' });
      try {
        const result = await fn(state.db);
        state.queries.push({ sql: 'commit', params: [], method: 'execute' });
        return result;
      } catch (error) {
        state.tables = saved;
        state.queries.push({ sql: 'rollback', params: [], method: 'execute' });
        throw error;
      }
    },
  });

  return state;
}
