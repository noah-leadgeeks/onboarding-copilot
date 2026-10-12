import { createFakeAgentDb, pgError, type FakeAgentDb } from './testing/fake-db';
import { generateAgentToken } from './tokens';

// jest.mock is not hoisted by this repo's transform, so it runs before lib/agent/auth is required below.
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

const { authenticateAgentRequest, withAgentRoute, isAgentRoute } = require('./auth') as typeof import('./auth');
const { agentJson } = require('./http') as typeof import('./http');
type AuthFailureReason = import('./auth').AuthFailureReason;

const ENV_KEYS = ['DATABASE_URL', 'AGENT_RATE_LIMIT_READS_PER_MIN', 'AGENT_RATE_LIMIT_PROPOSALS_PER_MIN'] as const;
const FAKE_DB_URL = 'postgres://fake:fake@db.invalid:5432/fake';
const BASE = 'http://localhost/api/agent/v1';
const NO_PARAMS = { params: Promise.resolve({}) };

interface Body {
  ok: boolean;
  error?: string;
  data?: unknown;
}

function addToken(scopes: string[], state: { revoked?: boolean; expired?: boolean } = {}): string {
  const generated = generateAgentToken();
  mockFake.tokens.push({
    id: `tok_${mockFake.tokens.length + 1}`,
    name: 'test token',
    tokenPrefix: generated.prefix,
    tokenHash: generated.hash,
    scopes,
    expiresAt: null,
    revoked: Boolean(state.revoked),
    expired: Boolean(state.expired),
  });
  return generated.token;
}

function request(path: string, token?: string | null, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request(`${BASE}${path}`, { ...init, headers });
}

let handlerCalls = 0;
const okHandler = async () => {
  handlerCalls += 1;
  return agentJson({ hello: 'world' });
};

describe('lib/agent/auth', () => {
  const savedEnv = new Map<string, string | undefined>();
  let warnSpy: jest.SpyInstance;

  beforeAll(() => {
    for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  });

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.DATABASE_URL = FAKE_DB_URL;
    mockFake = createFakeAgentDb();
    handlerCalls = 0;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('authenticateAgentRequest', () => {
    it('returns 503 agent_api_requires_database without DATABASE_URL and runs no query', async () => {
      delete process.env.DATABASE_URL;
      const token = addToken(['diary:read']);
      const result = await authenticateAgentRequest(request('/diary', token));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.response.status).toBe(503);
      expect(((await result.response.json()) as Body).error).toBe('agent_api_requires_database');
      expect(mockFake.queries).toHaveLength(0);
    });

    it('accepts a valid token and updates last_used_at only when older than a minute', async () => {
      const token = addToken(['diary:read', 'bogus:scope']);
      const result = await authenticateAgentRequest(request('/diary', token));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.ctx.tokenId).toBe('tok_1');
      // Unknown stored scopes make the whole list invalid -> no scopes (fail closed).
      expect(result.ctx.scopes).toEqual([]);
      expect(mockFake.lastUsedUpdates).toEqual(['tok_1']);
      const update = mockFake.queries.find((q) => q.sql.startsWith('update "agent_tokens"'));
      expect(update?.sql).toContain(`"agent_tokens"."last_used_at" is null`);
      expect(update?.sql).toContain(`"agent_tokens"."last_used_at" < now() - interval '1 minute'`);
      expect(mockFake.audit).toHaveLength(0);
    });

    const cases: Array<[AuthFailureReason, (valid: string) => string | null, { revoked?: boolean; expired?: boolean }, boolean]> = [
      ['missing', () => null, {}, false],
      ['malformed', () => 'nova_agt_short', {}, false],
      ['unknown', () => generateAgentToken().token, {}, false],
      ['revoked', (valid) => valid, { revoked: true }, true],
      ['expired', (valid) => valid, { expired: true }, true],
    ];
    for (const [reason, pick, state, hasTokenId] of cases) {
      it(`returns 401 invalid_token for a ${reason} token and audits auth.failed`, async () => {
        const valid = addToken(['diary:read'], state);
        const result = await authenticateAgentRequest(request('/diary?x=1', pick(valid)));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe(reason);
        expect(result.response.status).toBe(401);
        expect(((await result.response.json()) as Body).error).toBe('invalid_token');
        expect(mockFake.audit).toHaveLength(1);
        const row = mockFake.audit[0];
        expect(row.action).toBe('auth.failed');
        expect(row.status_code).toBe(401);
        expect(row.path).toBe('/api/agent/v1/diary');
        expect(row.details).toEqual({ reason });
        expect(row.token_id ?? null).toBe(hasTokenId ? 'tok_1' : null);
        expect(mockFake.lastUsedUpdates).toHaveLength(0);
      });
    }

    it('treats a non-Bearer Authorization header as malformed', async () => {
      const result = await authenticateAgentRequest(request('/diary', null, { headers: { Authorization: 'Basic abc' } }));
      expect(result.ok ? null : result.reason).toBe('malformed');
    });

    it('stops writing auth.failed rows once 20 exist in the last minute (21st writes no row)', async () => {
      for (let i = 0; i < 19; i += 1) mockFake.audit.push({ id: `seed-${i}`, actor: 'agent', action: 'auth.failed' });
      await authenticateAgentRequest(request('/diary', 'nova_agt_bad'));
      expect(mockFake.audit).toHaveLength(20);

      const result = await authenticateAgentRequest(request('/diary', 'nova_agt_bad'));
      expect(result.ok ? 200 : result.response.status).toBe(401);
      expect(mockFake.audit).toHaveLength(20);
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('auth.failed audit cap'))).toBe(true);
    });

    it('stores a sanitized, truncated token_prefix and never the presented value', async () => {
      const hostile = 'nova_agt_<script>alert(1)</script>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      await authenticateAgentRequest(request('/diary', hostile));
      const prefix = String(mockFake.audit[0].token_prefix);
      expect(prefix).toMatch(/^[A-Za-z0-9_]{1,17}$/);
      expect(prefix).toBe('nova_agt_script');

      const unknown = generateAgentToken().token;
      await authenticateAgentRequest(request('/diary', unknown));
      const stored = JSON.stringify(mockFake.audit[1]);
      expect(String(mockFake.audit[1].token_prefix)).toBe(unknown.slice(0, 17).replace(/[^A-Za-z0-9_]/g, ''));
      expect(stored.includes(unknown)).toBe(false);
    });
  });

  describe('withAgentRoute', () => {
    it('marks the wrapped handler and rejects an action outside its class at definition', () => {
      const route = withAgentRoute(okHandler, { scope: 'diary:read', kind: 'read', action: 'read.diary' });
      expect(isAgentRoute(route)).toBe(true);
      expect(isAgentRoute(okHandler)).toBe(false);
      expect(() => withAgentRoute(okHandler, { scope: 'diary:read', kind: 'read', action: 'propose.diary.update' })).toThrow();
      expect(() => withAgentRoute(okHandler, { scope: 'any-propose', kind: 'proposal', action: 'read.diary' })).toThrow();
    });

    it('runs the handler, finalizes the audit row and sets no-store', async () => {
      const token = addToken(['diary:read']);
      const route = withAgentRoute(okHandler, { scope: 'diary:read', kind: 'read', action: 'read.diary' });
      const res = await route(request('/diary/14?secret=nova_agt_leak&b=2', token), NO_PARAMS);
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(((await res.json()) as Body).data).toEqual({ hello: 'world' });
      expect(handlerCalls).toBe(1);
      expect(mockFake.audit).toHaveLength(1);
      const row = mockFake.audit[0];
      expect(row.action).toBe('read.diary');
      expect(row.actor).toBe('agent');
      expect(row.token_id).toBe('tok_1');
      expect(row.method).toBe('GET');
      expect(row.path).toBe('/api/agent/v1/diary/14');
      expect(row.status_code).toBe(200);
      expect(typeof row.duration_ms).toBe('number');
      expect(JSON.stringify(mockFake.audit).includes('nova_agt_leak')).toBe(false);
      expect(JSON.stringify(mockFake.audit).includes('?')).toBe(false);
    });

    it('returns 401 for a bad token without calling the handler', async () => {
      const route = withAgentRoute(okHandler, { scope: 'diary:read', kind: 'read', action: 'read.diary' });
      const res = await route(request('/diary', 'nova_agt_nope'), NO_PARAMS);
      expect(res.status).toBe(401);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(handlerCalls).toBe(0);
    });

    it('returns 503 without DATABASE_URL and writes nothing', async () => {
      delete process.env.DATABASE_URL;
      const route = withAgentRoute(okHandler, { scope: 'any', kind: 'read', action: 'read.me' });
      const res = await route(request('/me', addToken(['diary:read'])), NO_PARAMS);
      expect(res.status).toBe(503);
      expect(((await res.json()) as Body).error).toBe('agent_api_requires_database');
      expect(mockFake.queries).toHaveLength(0);
      expect(handlerCalls).toBe(0);
    });

    it('returns 403 insufficient_scope for a wrong scope and audits it', async () => {
      const token = addToken(['diary:read']);
      const route = withAgentRoute(okHandler, { scope: 'schedule:read', kind: 'read', action: 'read.schedule' });
      const res = await route(request('/schedule?date=2026-10-12', token), NO_PARAMS);
      expect(res.status).toBe(403);
      expect(((await res.json()) as Body).error).toBe('insufficient_scope');
      expect(handlerCalls).toBe(0);
      expect(mockFake.audit).toHaveLength(1);
      const row = mockFake.audit[0];
      expect(row.action).toBe('insufficient_scope');
      expect(row.status_code).toBe(403);
      expect(row.token_id).toBe('tok_1');
      expect(row.path).toBe('/api/agent/v1/schedule');
      expect(row.details).toEqual({ requiredScope: 'schedule:read' });
    });

    it('supports a dynamic scope function', async () => {
      const token = addToken(['diary:read']);
      const route = withAgentRoute(okHandler, {
        scope: (_ctx, req) => `${new URL(req.url).searchParams.get('domain')}:read`,
        kind: 'read',
        action: 'read.proposals',
      });
      expect((await route(request('/x?domain=diary', token), NO_PARAMS)).status).toBe(200);
      expect((await route(request('/x?domain=schedule', token), NO_PARAMS)).status).toBe(403);
      expect(handlerCalls).toBe(1);
    });

    it('accepts any valid token for scope any and requires a propose scope for any-propose', async () => {
      const reader = addToken(['diary:read']);
      const proposer = addToken(['diary:propose']);
      const me = withAgentRoute(okHandler, { scope: 'any', kind: 'read', action: 'read.me' });
      const create = withAgentRoute(okHandler, { scope: 'any-propose', kind: 'proposal', action: 'propose.pending' });
      const list = withAgentRoute(okHandler, { scope: 'proposals:read', kind: 'read', action: 'read.proposals' });
      expect((await me(request('/me', reader), NO_PARAMS)).status).toBe(200);
      expect((await create(request('/proposals', reader, { method: 'POST' }), NO_PARAMS)).status).toBe(403);
      expect((await create(request('/proposals', proposer, { method: 'POST' }), NO_PARAMS)).status).toBe(200);
      expect((await list(request('/proposals', reader), NO_PARAMS)).status).toBe(403);
      expect((await list(request('/proposals', proposer), NO_PARAMS)).status).toBe(200);
    });

    it('maps a 42P01 error from the audit insert to 503 agent_tables_missing with no audit row', async () => {
      const token = addToken(['diary:read']);
      mockFake.failWith = (q) => (q.sql.startsWith('insert into "agent_audit_log"') ? pgError('42P01') : undefined);
      const route = withAgentRoute(okHandler, { scope: 'diary:read', kind: 'read', action: 'read.diary' });
      const res = await route(request('/diary', token), NO_PARAMS);
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(((await res.json()) as Body).error).toBe('agent_tables_missing');
      expect(mockFake.audit).toHaveLength(0);
      expect(handlerCalls).toBe(0);
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('42P01'))).toBe(true);
    });

    it('maps 42P01 from the token lookup and from the auth.failed insert to 503', async () => {
      const route = withAgentRoute(okHandler, { scope: 'diary:read', kind: 'read', action: 'read.diary' });
      mockFake.failWith = (q) => (q.sql.includes('"agent_tokens"') ? pgError('42P01') : undefined);
      expect((await route(request('/diary', addToken(['diary:read'])), NO_PARAMS)).status).toBe(503);

      mockFake.failWith = (q) => (q.sql.includes('"agent_audit_log"') ? pgError('42P01') : undefined);
      expect((await route(request('/diary', 'nova_agt_bad'), NO_PARAMS)).status).toBe(503);
      expect(mockFake.audit).toHaveLength(0);
    });

    it('maps 42P01 thrown by the handler to 503', async () => {
      const token = addToken(['diary:read']);
      const route = withAgentRoute(
        async () => {
          throw pgError('42P01');
        },
        { scope: 'diary:read', kind: 'read', action: 'read.diary' }
      );
      const res = await route(request('/diary', token), NO_PARAMS);
      expect(res.status).toBe(503);
      expect(((await res.json()) as Body).error).toBe('agent_tables_missing');
    });

    it('fails closed with 500 when the audit reserve fails for another reason', async () => {
      const token = addToken(['diary:read']);
      mockFake.failWith = (q) => (q.sql.startsWith('insert into "agent_audit_log"') ? pgError('08006') : undefined);
      const route = withAgentRoute(okHandler, { scope: 'diary:read', kind: 'read', action: 'read.diary' });
      const res = await route(request('/diary', token), NO_PARAMS);
      expect(res.status).toBe(500);
      expect(handlerCalls).toBe(0);
    });

    it('turns a handler throw into 500 and does not store the message', async () => {
      const token = addToken(['diary:read']);
      const route = withAgentRoute(
        async () => {
          throw new Error('secret payload text');
        },
        { scope: 'diary:read', kind: 'read', action: 'read.diary' }
      );
      const res = await route(request('/diary', token), NO_PARAMS);
      expect(res.status).toBe(500);
      const body = (await res.json()) as Body & { message?: string };
      expect(body.error).toBe('internal_error');
      expect(JSON.stringify(body).includes('secret payload text')).toBe(false);
      expect(mockFake.audit[0].status_code).toBe(500);
      expect(JSON.stringify(mockFake.audit).includes('secret payload text')).toBe(false);
    });

    it('lets the handler refine the audit action and details within its class', async () => {
      const token = addToken(['diary:propose']);
      const route = withAgentRoute(
        async (_req, ctx) => {
          ctx.audit.action = 'propose.diary.update';
          ctx.audit.details = { fields: ['learned'] };
          return agentJson({ id: 'p1' }, { status: 202 });
        },
        { scope: 'any-propose', kind: 'proposal', action: 'propose.pending' }
      );
      const res = await route(request('/proposals', token, { method: 'POST' }), NO_PARAMS);
      expect(res.status).toBe(202);
      expect(mockFake.audit[0].action).toBe('propose.diary.update');
      expect(mockFake.audit[0].details).toEqual({ fields: ['learned'] });
      expect(mockFake.audit[0].status_code).toBe(202);
    });

    it('returns 429 with Retry-After after N reads and records rate_limited', async () => {
      process.env.AGENT_RATE_LIMIT_READS_PER_MIN = '3';
      const token = addToken(['diary:read']);
      const route = withAgentRoute(okHandler, { scope: 'diary:read', kind: 'read', action: 'read.diary' });
      for (let i = 0; i < 3; i += 1) {
        expect((await route(request('/diary', token), NO_PARAMS)).status).toBe(200);
      }
      const limited = await route(request('/diary', token), NO_PARAMS);
      expect(limited.status).toBe(429);
      expect(limited.headers.get('Retry-After')).toBe('60');
      expect(limited.headers.get('Cache-Control')).toBe('no-store');
      expect(((await limited.json()) as Body).error).toBe('rate_limited');
      expect(handlerCalls).toBe(3);
      const last = mockFake.audit[mockFake.audit.length - 1];
      expect(last.action).toBe('rate_limited');
      expect(last.status_code).toBe(429);

      // rate_limited rows are excluded from the count, so the window does not grow from retries.
      expect((await route(request('/diary', token), NO_PARAMS)).status).toBe(429);
      expect(mockFake.audit.filter((r) => r.action === 'read.diary')).toHaveLength(3);
    });

    it('counts propose.% and cancel only for the proposal class, excluding rate_limited/auth.failed', async () => {
      process.env.AGENT_RATE_LIMIT_PROPOSALS_PER_MIN = '2';
      const token = addToken(['diary:propose']);
      const seed = (action: string) =>
        mockFake.audit.push({ id: `seed-${mockFake.audit.length}`, actor: 'agent', token_id: 'tok_1', action });
      for (let i = 0; i < 10; i += 1) seed('read.diary');
      seed('rate_limited');
      seed('rate_limited');
      seed('auth.failed');
      seed('insufficient_scope');
      const route = withAgentRoute(okHandler, { scope: 'any-propose', kind: 'proposal', action: 'cancel' });

      // Only non-proposal rows exist: first two proposals pass.
      expect((await route(request('/proposals/p1/cancel', token, { method: 'POST' }), NO_PARAMS)).status).toBe(200);
      seed('propose.diary.update');
      // cancel + propose.diary.update + this request = 3 > 2.
      expect((await route(request('/proposals/p2/cancel', token, { method: 'POST' }), NO_PARAMS)).status).toBe(429);

      const countQuery = mockFake.queries.filter((q) => q.sql.startsWith('select count(*)::int from "agent_audit_log"')).pop();
      expect(countQuery?.sql).toContain(
        `("agent_audit_log"."action" LIKE 'propose.%' OR "agent_audit_log"."action" = 'cancel')`
      );
      expect(countQuery?.sql).toContain(`"agent_audit_log"."action" NOT IN ('rate_limited', 'auth.failed')`);
      expect(countQuery?.sql).toContain(`interval '1 minute'`);
    });

    it('does not count proposals against the read limit', async () => {
      process.env.AGENT_RATE_LIMIT_READS_PER_MIN = '1';
      const token = addToken(['diary:read']);
      for (let i = 0; i < 5; i += 1) {
        mockFake.audit.push({ id: `seed-${i}`, actor: 'agent', token_id: 'tok_1', action: 'propose.diary.update' });
      }
      mockFake.audit.push({ id: 'seed-c', actor: 'agent', token_id: 'tok_1', action: 'cancel' });
      const route = withAgentRoute(okHandler, { scope: 'diary:read', kind: 'read', action: 'read.diary' });
      expect((await route(request('/diary', token), NO_PARAMS)).status).toBe(200);
      expect((await route(request('/diary', token), NO_PARAMS)).status).toBe(429);
    });
  });
});
