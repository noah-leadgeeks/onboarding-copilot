/**
 * Step 8: token admin routes (`/api/agent-admin/tokens`, `/tokens/:id/revoke`, `/audit`) on a small
 * in-memory pg-proxy fake that interprets exactly the statements lib/agent/tokens-admin.ts emits and
 * records their SQL, so the revoke lock order can be asserted. Real-Postgres behaviour of revoke is
 * covered by tokens-admin.integration.test.ts and approvals.integration.test.ts (b).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { drizzle } from 'drizzle-orm/pg-proxy';
import { serializeSessionCookie } from '@/lib/auth/session';
import * as schema from '@/lib/db/schema';
import { hashAgentToken, isValidTokenFormat } from '@/lib/agent/tokens';

type Row = Record<string, unknown>;

/** `toMatchObject` stand-in (lib/test-globals.d.ts types only a subset of matchers). */
function subset(value: unknown, keys: readonly string[]): Row {
  const record = (value ?? {}) as Row;
  return Object.fromEntries(keys.map((key) => [key, record[key]]));
}

function expectSubset(value: unknown, expected: Row): void {
  expect(subset(value, Object.keys(expected))).toEqual(expected);
}

interface TokenFake {
  db: ReturnType<typeof drizzle<typeof schema>>;
  sql: string[];
  tokens: Row[];
  proposals: Row[];
  audit: Row[];
  failWith: Error | null;
}

const TOKEN_VIEW_COLUMNS = ['id', 'name', 'token_prefix', 'scopes', 'created_at', 'expires_at', 'last_used_at', 'revoked_at'];

function splitValues(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function parseInsert(sqlText: string, params: unknown[]): Row {
  const match = /^insert into "\w+" \(([^)]*)\) values \(([^]*?)\)(?: returning [^]*)?$/.exec(sqlText);
  if (!match) throw new Error(`token fake: cannot parse insert: ${sqlText}`);
  const columns = match[1].split(',').map((c) => c.trim().replace(/"/g, ''));
  const values = splitValues(match[2]);
  const row: Row = {};
  columns.forEach((column, index) => {
    const token = values[index];
    const ref = /\$(\d+)/.exec(token);
    if (token === 'default') row[column] = null;
    else if (/^\$\d+$/.test(token)) row[column] = params[Number(token.slice(1)) - 1];
    else row[column] = { sql: token, param: ref ? params[Number(ref[1]) - 1] : undefined };
  });
  return row;
}

function createTokenFake(): TokenFake {
  const state: TokenFake = {
    db: undefined as unknown as TokenFake['db'],
    sql: [],
    tokens: [],
    proposals: [],
    audit: [],
    failWith: null,
  };
  const project = (row: Row) => TOKEN_VIEW_COLUMNS.map((column) => row[column] ?? null);
  state.db = drizzle(
    async (sqlText, params) => {
      state.sql.push(sqlText);
      if (state.failWith) throw state.failWith;
      if (sqlText.startsWith('insert into "agent_tokens"')) {
        const row = parseInsert(sqlText, params);
        row.scopes = JSON.parse(String(row.scopes));
        row.created_at = '2026-10-12 00:00:00+00';
        row.expires_at_days = (row.expires_at as { param: unknown }).param;
        row.expires_at = '2027-01-10 00:00:00+00';
        state.tokens.push(row);
        return { rows: [project(row)] };
      }
      if (sqlText.startsWith('select "id", "name", "token_prefix"') && sqlText.includes('from "agent_tokens" order by')) {
        return { rows: [...state.tokens].reverse().map(project) };
      }
      if (sqlText.startsWith('update "agent_tokens" set "revoked_at" = now()')) {
        const token = state.tokens.find((t) => t.id === params[0] && t.revoked_at == null);
        if (!token) return { rows: [] };
        token.revoked_at = '2026-10-12 01:00:00+00';
        return { rows: [[token.id, token.token_prefix]] };
      }
      if (sqlText.startsWith('select "id" from "agent_tokens" where "agent_tokens"."id" = $1')) {
        const token = state.tokens.find((t) => t.id === params[0]);
        return { rows: token ? [[token.id]] : [] };
      }
      if (sqlText.startsWith('select "id" from "agent_proposals"') && sqlText.endsWith(' for no key update')) {
        return { rows: state.proposals.filter((p) => p.token_id === params[0] && p.status === params[1]).map((p) => [p.id]) };
      }
      if (sqlText.startsWith('update "agent_proposals" set "status" = $1')) {
        const ids = params.slice(3, params.length - 1);
        const statusFilter = params[params.length - 1];
        const hit = state.proposals.filter((p) => ids.includes(p.id) && p.status === statusFilter);
        for (const p of hit) Object.assign(p, { status: params[0], decided_by: params[1], result: params[2] });
        return { rows: hit.map((p) => [p.id]) };
      }
      if (sqlText.startsWith('insert into "agent_audit_log"')) {
        const row = parseInsert(sqlText, params);
        if (typeof row.details === 'string') row.details = JSON.parse(row.details);
        state.audit.push(row);
        return { rows: [] };
      }
      if (sqlText.startsWith('select "id", "created_at", "actor"') && sqlText.includes('from "agent_audit_log"')) {
        const filtered = sqlText.includes('where "agent_audit_log"."token_id" = $1')
          ? state.audit.filter((a) => a.token_id === params[0])
          : state.audit;
        const columns = ['id', 'created_at', 'actor', 'action', 'token_id', 'token_prefix', 'user_email', 'proposal_id', 'method', 'path', 'status_code', 'duration_ms', 'details'];
        return { rows: filtered.map((a) => columns.map((c) => (c === 'created_at' ? '2026-10-12 00:00:00+00' : a[c] ?? null))) };
      }
      throw new Error(`token fake: unexpected query: ${sqlText}`);
    },
    { schema }
  );
  Object.defineProperty(state.db, 'transaction', {
    configurable: true,
    value: async <T>(fn: (tx: TokenFake['db']) => Promise<T>): Promise<T> => {
      state.sql.push('begin');
      const result = await fn(state.db);
      state.sql.push('commit');
      return result;
    },
  });
  return state;
}

let mockFake: TokenFake = createTokenFake();
// jest.mock is not hoisted by this repo's transform, so it runs before the routes are required below.
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
const tokensRoute = require('@/app/api/agent-admin/tokens/route') as { GET: Handler; POST: Handler };
const revokeRoute = require('@/app/api/agent-admin/tokens/[id]/revoke/route') as { POST: Handler };
const auditRoute = require('@/app/api/agent-admin/audit/route') as { GET: Handler };

const ENV_KEYS = ['DATABASE_URL', 'AUTH_SECRET', 'GOOGLE_CLIENT_SECRET', 'AGENT_ADMIN_EMAILS', 'AUTH_DISABLED', 'VERCEL', 'AGENT_TOKEN_DEFAULT_TTL_DAYS'] as const;
const OWNER = 'owner@example.com';
const BASE = 'http://localhost/api/agent-admin';

interface Body {
  ok: boolean;
  error?: string;
  data?: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- response JSON is asserted structurally
}

let saved: Record<string, string | undefined> = {};

function cookieFor(email = OWNER): string {
  return serializeSessionCookie({
    user: { id: 'u1', email, name: 'Owner' },
    tokens: { accessToken: 'a', expiresAt: Date.now() + 3_600_000, scope: '' },
    createdAt: new Date().toISOString(),
  });
}

function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers: { cookie: `nova_session=${cookieFor()}`, ...headers } });
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `nova_session=${cookieFor()}`, ...headers },
    body: JSON.stringify(body),
  });
}

async function call(handler: Handler, request: Request, params: Record<string, string> = {}) {
  const response = await handler(request, { params: Promise.resolve(params) });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as Body, text, cache: response.headers.get('cache-control') };
}

const issue = (body: unknown, headers: Record<string, string> = {}) => call(tokensRoute.POST, post(`${BASE}/tokens`, body, headers));
const list = (headers: Record<string, string> = {}, qs = '') => call(tokensRoute.GET, get(`${BASE}/tokens${qs}`, headers));
const revoke = (id: string, body: unknown = {}) => call(revokeRoute.POST, post(`${BASE}/tokens/${id}/revoke`, body), { id });
const audit = (qs = '') => call(auditRoute.GET, get(`${BASE}/audit${qs}`));

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.DATABASE_URL = 'postgres://fake:fake@db.invalid:5432/fake';
  process.env.AUTH_SECRET = 'tokens-admin-test-secret';
  delete process.env.GOOGLE_CLIENT_SECRET;
  process.env.AGENT_ADMIN_EMAILS = OWNER;
  delete process.env.AUTH_DISABLED;
  delete process.env.VERCEL;
  delete process.env.AGENT_TOKEN_DEFAULT_TTL_DAYS;
  mockFake = createTokenFake();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  jest.restoreAllMocks();
});

describe('POST /api/agent-admin/tokens (issue)', () => {
  it('returns the plaintext once, stores only the hash, and audits token.issue without the token', async () => {
    const res = await issue({ name: '  OpenClaw laptop ', scopes: ['diary:propose', 'diary:read', 'diary:read'] });
    expect(res.status).toBe(201);
    expect(res.cache).toBe('no-store');
    const { token, tokenInfo } = res.body.data;
    expect(isValidTokenFormat(token)).toBe(true);
    expect(tokenInfo.id).toMatch(/^tok_/);
    expect({ ...tokenInfo, id: 'tok' }).toEqual({
      id: 'tok',
      name: 'OpenClaw laptop',
      prefix: token.slice(0, 17),
      scopes: ['diary:read', 'diary:propose'],
      createdAt: '2026-10-12T00:00:00.000Z',
      expiresAt: '2027-01-10T00:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(tokenInfo)).not.toContain('hash');

    const stored = mockFake.tokens[0];
    expect(stored.token_hash).toBe(hashAgentToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.created_by).toBe(OWNER);
    expect(stored.expires_at_days).toBe(90); // default from config

    expect(mockFake.audit).toHaveLength(1);
    const row = mockFake.audit[0];
    expectSubset(row, { actor: 'user', action: 'token.issue', token_id: tokenInfo.id, user_email: OWNER, path: '/api/agent-admin/tokens', status_code: 201 });
    expect(row.details).toEqual({ scopes: ['diary:read', 'diary:propose'], expiresInDays: 90 });
    expect(JSON.stringify(mockFake.audit)).not.toContain(token);
    expect(mockFake.sql.indexOf('begin')).toBeLessThan(mockFake.sql.findIndex((s) => s.startsWith('insert into "agent_tokens"')));
  });

  it('uses expiresInDays when given and AGENT_TOKEN_DEFAULT_TTL_DAYS otherwise', async () => {
    await issue({ name: 'a', scopes: ['glossary:read'], expiresInDays: 30 });
    process.env.AGENT_TOKEN_DEFAULT_TTL_DAYS = '14';
    await issue({ name: 'b', scopes: ['glossary:read'] });
    expect(mockFake.tokens.map((t) => t.expires_at_days)).toEqual([30, 14]);
  });

  const invalidBodies: unknown[] = [
    { scopes: ['diary:read'] },
    { name: '   ', scopes: ['diary:read'] },
    { name: 'x'.repeat(81), scopes: ['diary:read'] },
    { name: 'line\nbreak', scopes: ['diary:read'] },
    { name: 'n', scopes: [] },
    { name: 'n', scopes: ['proposals:read'] },
    { name: 'n', scopes: ['admin'] },
    { name: 'n', scopes: 'diary:read' },
    { name: 'n', scopes: ['diary:read'], expiresInDays: 0 },
    { name: 'n', scopes: ['diary:read'], expiresInDays: 366 },
    { name: 'n', scopes: ['diary:read'], expiresInDays: 1.5 },
    { name: 'n', scopes: ['diary:read'], expiresInDays: '30' },
    { name: 'n', scopes: ['diary:read'], extra: true },
    ['diary:read'],
  ];
  for (const body of invalidBodies) {
    it(`rejects invalid body ${JSON.stringify(body).slice(0, 60)} with 400 and inserts nothing`, async () => {
      const res = await issue(body);
      expect([res.status, res.body.error]).toEqual([400, 'invalid_request']);
      expect(mockFake.tokens).toHaveLength(0);
      expect(mockFake.audit).toHaveLength(0);
    });
  }
});

describe('GET /api/agent-admin/tokens (list)', () => {
  it('lists tokens newest first without the hash, plus the default expiry', async () => {
    const first = await issue({ name: 'one', scopes: ['diary:read'] });
    const second = await issue({ name: 'two', scopes: ['schedule:read'] });
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.data.defaultExpiresInDays).toBe(90);
    expect(res.body.data.tokens.map((t: { name: string }) => t.name)).toEqual(['two', 'one']);
    for (const t of res.body.data.tokens) expect(Object.keys(t).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'lastUsedAt', 'name', 'prefix', 'revokedAt', 'scopes']);
    expect(res.text).not.toContain(String(mockFake.tokens[0].token_hash));
    expect(res.text).not.toContain(first.body.data.token);
    expect(res.text).not.toContain(second.body.data.token);
    expect(mockFake.sql.find((s) => s.includes('from "agent_tokens" order by'))).not.toContain('token_hash');
  });

  it('rejects unknown query parameters', async () => {
    expect((await list({}, '?all=1')).status).toBe(400);
  });
});

describe('POST /api/agent-admin/tokens/:id/revoke', () => {
  async function seedToken(name: string): Promise<string> {
    const res = await issue({ name, scopes: ['diary:propose'] });
    return res.body.data.tokenInfo.id as string;
  }

  it('UPDATE-locks the token first, then locks and cancels only its pending proposals, in one transaction', async () => {
    const id = await seedToken('old');
    const other = await seedToken('other');
    mockFake.proposals.push(
      { id: 'prp_a', token_id: id, status: 'pending' },
      { id: 'prp_b', token_id: id, status: 'pending' },
      { id: 'prp_done', token_id: id, status: 'executed' },
      { id: 'prp_other', token_id: other, status: 'pending' }
    );
    mockFake.sql = [];
    mockFake.audit = [];

    const res = await revoke(id);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: 'revoked', cancelledProposalIds: ['prp_a', 'prp_b'] });
    expect(mockFake.proposals.map((p) => [p.id, p.status])).toEqual([
      ['prp_a', 'cancelled'],
      ['prp_b', 'cancelled'],
      ['prp_done', 'executed'],
      ['prp_other', 'pending'],
    ]);
    expect(mockFake.proposals[0].decided_by).toBe(OWNER);

    const shapes = mockFake.sql.map((s) => (s.startsWith('insert into "agent_audit_log"') ? 'insert into "agent_audit_log"' : s.split(' where ')[0]));
    expect(shapes).toEqual([
      'begin',
      'update "agent_tokens" set "revoked_at" = now()',
      'select "id" from "agent_proposals"',
      'update "agent_proposals" set "status" = $1, "decided_at" = now(), "decided_by" = $2, "result" = $3',
      'insert into "agent_audit_log"',
      'commit',
    ]);
    expect(mockFake.sql[1]).toContain('"agent_tokens"."revoked_at" is null');
    expect(mockFake.sql[2]).toMatch(/ for no key update$/);
    for (const statement of mockFake.sql.filter((s) => s.includes('"agent_tokens"'))) {
      expect(statement).not.toMatch(/for (no key )?update|for share/);
    }
    expectSubset(mockFake.audit[0], { action: 'token.revoke', token_id: id, user_email: OWNER, status_code: 200 });
    expect(mockFake.audit[0].details).toEqual({ cancelled: 2 });
  });

  it('is idempotent for an already revoked token, 404 for an unknown one, 400 for bad input', async () => {
    const id = await seedToken('t');
    expect((await revoke(id)).body.data.status).toBe('revoked');
    const again = await revoke(id);
    expect([again.status, again.body.data]).toEqual([200, { status: 'already_revoked', cancelledProposalIds: [] }]);
    const missing = await revoke('tok_missing');
    expect([missing.status, missing.body.error]).toEqual([404, 'not_found']);
    expect((await revoke('bad id!')).status).toBe(400);
    expect((await revoke(id, { force: true })).status).toBe(400);
  });
});

describe('GET /api/agent-admin/audit', () => {
  it('filters by tokenId and caps limit at 200', async () => {
    const res = await issue({ name: 'a', scopes: ['diary:read'] });
    const id = res.body.data.tokenInfo.id;
    const rows = await audit(`?tokenId=${id}&limit=999`);
    expect(rows.status).toBe(200);
    expect(rows.body.data.rows).toHaveLength(1);
    expectSubset(rows.body.data.rows[0], { action: 'token.issue', tokenId: id, createdAt: '2026-10-12T00:00:00.000Z' });
    expect(mockFake.sql[mockFake.sql.length - 1]).toMatch(/limit \$2$/);
    const none = await audit('?tokenId=tok_other');
    expect(none.body.data.rows).toEqual([]);
  });

  for (const qs of ['?limit=0', '?limit=abc', '?limit=-1', '?tokenId=bad%20id', '?other=1']) {
    it(`rejects ${qs} with 400`, async () => {
      expect((await audit(qs)).status).toBe(400);
    });
  }
});

describe('guards (requireAdminSession) and 42P01 degradation', () => {
  it('no AUTH_SECRET: issue (and list) are 503 auth_secret_required', async () => {
    delete process.env.AUTH_SECRET;
    const res = await issue({ name: 'a', scopes: ['diary:read'] });
    expect([res.status, res.body.error]).toEqual([503, 'auth_secret_required']);
    expect((await list()).status).toBe(503);
    expect(mockFake.sql).toHaveLength(0);
  });

  it('allowlist unset -> 403 admin_allowlist_unset; non-owner -> 403 not_owner; owner email is case-insensitive', async () => {
    delete process.env.AGENT_ADMIN_EMAILS;
    expect((await issue({ name: 'a', scopes: ['diary:read'] })).body.error).toBe('admin_allowlist_unset');
    process.env.AGENT_ADMIN_EMAILS = 'someone@example.com';
    const denied = await issue({ name: 'a', scopes: ['diary:read'] });
    expect([denied.status, denied.body.error]).toEqual([403, 'not_owner']);
    expect((await revoke('tok_x')).body.error).toBe('not_owner');
    expect((await audit()).body.error).toBe('not_owner');
    process.env.AGENT_ADMIN_EMAILS = ` SomeOne@example.com , ${OWNER.toUpperCase()}`;
    expect((await issue({ name: 'a', scopes: ['diary:read'] })).status).toBe(201);
  });

  it('bearer header -> 400, wrong content type -> 415, cross-origin -> 403, no session -> 401, no DB -> 503', async () => {
    expect((await issue({ name: 'a', scopes: ['diary:read'] }, { authorization: 'Bearer nova_agt_x' })).body.error).toBe('bearer_not_allowed');
    expect((await issue({ name: 'a', scopes: ['diary:read'] }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await issue({ name: 'a', scopes: ['diary:read'] }, { origin: 'https://evil.example' })).body.error).toBe('bad_origin');
    expect((await call(tokensRoute.GET, new Request(`${BASE}/tokens`))).status).toBe(401);
    delete process.env.DATABASE_URL;
    expect((await list()).body.error).toBe('agent_api_requires_database');
    expect(mockFake.tokens).toHaveLength(0);
  });

  it('42P01 maps to 200 agent_tables_missing on GET tokens/audit and 503 on POST', async () => {
    mockFake.failWith = Object.assign(new Error('relation "agent_tokens" does not exist'), { code: '42P01' });
    for (const res of [await list(), await audit()]) {
      expect(res.status).toBe(200);
      expect([res.body.ok, res.body.error]).toEqual([false, 'agent_tables_missing']);
    }
    const posted = await issue({ name: 'a', scopes: ['diary:read'] });
    expect([posted.status, posted.body.error]).toEqual([503, 'agent_tables_missing']);
    const revoked = await revoke('tok_x');
    expect([revoked.status, revoked.body.error]).toEqual([503, 'agent_tables_missing']);
  });

  it('other database errors are a log-safe 500', async () => {
    mockFake.failWith = Object.assign(new Error('boom with secret value'), { code: '57P01' });
    const res = await list();
    expect([res.status, res.body.error]).toEqual([500, 'internal_error']);
    expect(res.text).not.toContain('secret value');
  });
});

describe('lock discipline (static)', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
    });
  }

  it("no .for('update') (or raw FOR UPDATE / FOR NO KEY UPDATE) on agent_tokens anywhere in lib/agent/**", () => {
    const files = sourceFiles(path.join(process.cwd(), 'lib', 'agent'));
    expect(files.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // Each query chain: from its `await`/statement start up to the lock clause.
      for (const match of text.matchAll(/\.for\(\s*['"](update|no key update)['"]/g)) {
        const start = Math.max(text.lastIndexOf('await ', match.index), text.lastIndexOf(';', match.index));
        const chain = text.slice(start, match.index);
        if (/agentTokens\b|agent_tokens/.test(chain)) offenders.push(`${path.relative(process.cwd(), file)}: .for('${match[1]}')`);
      }
      for (const match of text.matchAll(/agent_tokens[^;`]*\bFOR\s+(NO\s+KEY\s+)?UPDATE\b/gi)) {
        offenders.push(`${path.relative(process.cwd(), file)}: ${match[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the static check would catch a token FOR UPDATE chain', () => {
    const sample = "const rows = await tx.select({ id: agentTokens.id }).from(agentTokens).where(x).for('update');";
    const match = /\.for\(\s*['"]update['"]/.exec(sample);
    expect(match).not.toBeNull();
    const chain = sample.slice(sample.lastIndexOf('await ', match!.index), match!.index);
    expect(/agentTokens\b/.test(chain)).toBe(true);
  });
});
