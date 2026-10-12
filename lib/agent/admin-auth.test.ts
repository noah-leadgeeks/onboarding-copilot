/**
 * Step 7: `requireAdminSession`, the six ordered checks for /api/agent-admin/* (B1, S6, S7).
 * `resolveActiveSession` is replaced by a throwing spy to prove it is never called.
 */
export {};

const mockResolveActiveSession = jest.fn(() => {
  throw new Error('resolveActiveSession must not be called by admin routes');
});
// jest.mock is not hoisted by this repo's transform, so it runs before admin-auth is required below.
jest.mock('@/lib/auth/session', () => ({
  ...jest.requireActual('@/lib/auth/session'),
  resolveActiveSession: mockResolveActiveSession,
}));

const { requireAdminSession, adminAllowlist } = require('./admin-auth') as typeof import('./admin-auth');
const { serializeSessionCookie } = require('@/lib/auth/session') as typeof import('@/lib/auth/session');

const ENV_KEYS = ['AUTH_SECRET', 'GOOGLE_CLIENT_SECRET', 'AGENT_ADMIN_EMAILS', 'AUTH_DISABLED', 'VERCEL', 'NODE_ENV'] as const;
const OWNER = 'owner@example.com';
const URL_APPROVE = 'http://app.local/api/agent-admin/proposals/prp_1/approve';
let saved: Record<string, string | undefined> = {};

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[key];
  else env[key] = value;
}

function sessionCookie(email = OWNER, expiresAt = Date.now() + 3_600_000, refreshToken?: string): string {
  return serializeSessionCookie({
    user: { id: 'u1', email, name: 'Owner' },
    tokens: { accessToken: 'a', expiresAt, scope: '', ...(refreshToken ? { refreshToken } : {}) },
    createdAt: new Date().toISOString(),
  });
}

function post(headers: Record<string, string> = {}, withCookie = true): Request {
  return new Request(URL_APPROVE, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(withCookie ? { cookie: `other=1; nova_session=${sessionCookie()}` } : {}),
      ...headers,
    },
    body: '{}',
  });
}

function get(headers: Record<string, string> = {}): Request {
  return new Request('http://app.local/api/agent-admin/proposals', { headers: { cookie: `nova_session=${sessionCookie()}`, ...headers } });
}

async function denial(request: Request): Promise<[number, string]> {
  const result = requireAdminSession(request);
  if (result.ok) return [200, 'ok'];
  expect(result.response.headers.get('cache-control')).toBe('no-store');
  const body = (await result.response.json()) as { ok: boolean; error: string };
  expect(body.ok).toBe(false);
  return [result.response.status, body.error];
}

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  setEnv('AUTH_SECRET', 'admin-auth-test-secret');
  setEnv('GOOGLE_CLIENT_SECRET', undefined);
  setEnv('AGENT_ADMIN_EMAILS', ` Someone@Else.com , ${OWNER.toUpperCase()} `);
  setEnv('AUTH_DISABLED', undefined);
  setEnv('VERCEL', undefined);
  setEnv('NODE_ENV', 'test');
  mockResolveActiveSession.mockClear();
});

afterEach(() => {
  for (const key of ENV_KEYS) setEnv(key, saved[key]);
  expect(mockResolveActiveSession.mock.calls.length).toBe(0);
});

describe('requireAdminSession', () => {
  it('passes for the allowlisted owner (POST and GET) and lower-cases the email', () => {
    const result = requireAdminSession(post());
    expect(result.ok && result.admin).toEqual({ email: OWNER, local: false });
    expect(requireAdminSession(get()).ok).toBe(true);
  });

  it('1. any Authorization header -> 400 bearer_not_allowed (even with a valid owner cookie)', async () => {
    expect(await denial(post({ authorization: 'Bearer nova_agt_x' }))).toEqual([400, 'bearer_not_allowed']);
    expect(await denial(get({ authorization: 'Basic abc' }))).toEqual([400, 'bearer_not_allowed']);
  });

  it('2. AUTH_DISABLED with VERCEL=1 or NODE_ENV=production -> 503', async () => {
    setEnv('AUTH_DISABLED', 'true');
    setEnv('VERCEL', '1');
    expect(await denial(post())).toEqual([503, 'auth_disabled_in_production']);
    setEnv('VERCEL', undefined);
    setEnv('NODE_ENV', 'production');
    expect(await denial(get())).toEqual([503, 'auth_disabled_in_production']);
  });

  it('3. no AUTH_SECRET and no GOOGLE_CLIENT_SECRET -> 503 auth_secret_required (GET and approve POST)', async () => {
    const request = post();
    const listRequest = get();
    setEnv('AUTH_SECRET', undefined);
    expect(await denial(request)).toEqual([503, 'auth_secret_required']);
    expect(await denial(listRequest)).toEqual([503, 'auth_secret_required']);
    setEnv('GOOGLE_CLIENT_SECRET', 'admin-auth-test-secret');
    expect(requireAdminSession(post()).ok).toBe(true);
  });

  it('4. mutating requests need application/json -> 415 otherwise', async () => {
    expect(await denial(post({ 'content-type': 'text/plain' }))).toEqual([415, 'unsupported_media_type']);
    expect(await denial(post({ 'content-type': 'application/x-www-form-urlencoded' }))).toEqual([415, 'unsupported_media_type']);
    expect(requireAdminSession(post({ 'content-type': 'application/json; charset=utf-8' })).ok).toBe(true);
    expect(requireAdminSession(get()).ok).toBe(true);
  });

  it('4. cross-origin Origin or Sec-Fetch-Site: cross-site -> 403 bad_origin; same origin passes', async () => {
    expect(await denial(post({ origin: 'https://evil.example' }))).toEqual([403, 'bad_origin']);
    expect(await denial(post({ origin: 'null' }))).toEqual([403, 'bad_origin']);
    expect(await denial(post({ 'sec-fetch-site': 'cross-site' }))).toEqual([403, 'bad_origin']);
    expect(requireAdminSession(post({ origin: 'http://app.local', 'sec-fetch-site': 'same-origin' })).ok).toBe(true);
  });

  it('5. no session, a garbage cookie or an expired session without refresh token -> 401', async () => {
    expect(await denial(post({}, false))).toEqual([401, 'unauthenticated']);
    expect(await denial(post({ cookie: 'nova_session=not-a-session' }))).toEqual([401, 'unauthenticated']);
    expect(await denial(post({ cookie: `nova_session=${sessionCookie(OWNER, Date.now() - 1_000)}` }))).toEqual([401, 'unauthenticated']);
    // Expired access token with a refresh token is valid (isSessionValid), and no refresh happens here.
    expect(requireAdminSession(post({ cookie: `nova_session=${sessionCookie(OWNER, Date.now() - 1_000, 'r')}` })).ok).toBe(true);
  });

  it('5. a cookie encrypted with another secret is rejected', async () => {
    const forged = sessionCookie();
    setEnv('AUTH_SECRET', 'a-different-secret');
    expect(await denial(post({ cookie: `nova_session=${forged}` }))).toEqual([401, 'unauthenticated']);
  });

  it('6. allowlist unset or empty -> 403 admin_allowlist_unset', async () => {
    setEnv('AGENT_ADMIN_EMAILS', undefined);
    expect(await denial(post())).toEqual([403, 'admin_allowlist_unset']);
    setEnv('AGENT_ADMIN_EMAILS', ' , ');
    expect(await denial(post())).toEqual([403, 'admin_allowlist_unset']);
  });

  it('6. non-owner -> 403 not_owner; upper-cased owner email passes', async () => {
    expect(await denial(post({ cookie: `nova_session=${sessionCookie('intruder@example.com')}` }))).toEqual([403, 'not_owner']);
    const upper = requireAdminSession(post({ cookie: `nova_session=${sessionCookie('OWNER@Example.COM')}` }));
    expect(upper.ok && upper.admin.email).toBe(OWNER);
  });

  it('5/6. AUTH_DISABLED locally: identity "local", still needs a configured allowlist; "local" email is rejected otherwise', async () => {
    setEnv('AUTH_DISABLED', 'true');
    const local = requireAdminSession(post({}, false));
    expect(local.ok && local.admin).toEqual({ email: 'local', local: true });
    setEnv('AGENT_ADMIN_EMAILS', undefined);
    expect(await denial(post({}, false))).toEqual([403, 'admin_allowlist_unset']);
    setEnv('AUTH_DISABLED', undefined);
    setEnv('AGENT_ADMIN_EMAILS', 'local');
    expect(await denial(post({ cookie: `nova_session=${sessionCookie('local')}` }))).toEqual([403, 'not_owner']);
  });

  it('checks run in order: bearer beats a missing secret, a missing secret beats a bad content type', async () => {
    setEnv('AUTH_SECRET', undefined);
    expect(await denial(post({ authorization: 'Bearer x', 'content-type': 'text/plain' }))).toEqual([400, 'bearer_not_allowed']);
    expect(await denial(post({ 'content-type': 'text/plain' }))).toEqual([503, 'auth_secret_required']);
  });

  it('adminAllowlist trims, lower-cases and drops empty entries', () => {
    expect(adminAllowlist(' A@B.com,, c@d.COM ')).toEqual(['a@b.com', 'c@d.com']);
    expect(adminAllowlist('')).toEqual([]);
  });
});
