import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { encryptSession } from './lib/auth/crypto';
import type { AuthSession } from './lib/auth/types';

const mockSession: AuthSession = {
  user: {
    id: 'google-user-123',
    email: 'employee@company.test',
    name: 'Employee Onboarding',
  },
  tokens: {
    accessToken: 'valid-access-token',
    expiresAt: Date.now() + 3600_000,
    scope: 'openid email profile',
  },
  createdAt: '2026-09-07T12:00:00.000Z',
};


describe('Next.js Middleware Auth Guard', () => {
  const originalEnv = process.env.AUTH_DISABLED;

  beforeEach(() => {
    delete process.env.AUTH_DISABLED;
  });

  afterAll(() => {
    if (originalEnv !== undefined) {
      process.env.AUTH_DISABLED = originalEnv;
    } else {
      delete process.env.AUTH_DISABLED;
    }
  });

  it('redirects unauthenticated page requests from / to /login', async () => {
    const req = new NextRequest('http://localhost:3000/');
    const res = await middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/login');
  });

  it('redirects unauthenticated page requests from /schedule to /login with redirect query', async () => {
    const req = new NextRequest('http://localhost:3000/schedule?tab=done');
    const res = await middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?redirect=%2Fschedule%3Ftab%3Ddone'
    );
  });

  it('returns 401 for unauthenticated API requests', async () => {
    const req = new NextRequest('http://localhost:3000/api/schedule');
    const res = await middleware(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
    expect(body.loginUrl).toBe('/login');
  });

  it('allows unauthenticated requests to /login', async () => {
    const req = new NextRequest('http://localhost:3000/login');
    const res = await middleware(req);

    // NextResponse.next() produces an internal 200 without redirect
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('allows unauthenticated requests to /api/health and /api/auth/*', async () => {
    const healthReq = new NextRequest('http://localhost:3000/api/health');
    const healthRes = await middleware(healthReq);
    expect(healthRes.status).toBe(200);

    const authReq = new NextRequest('http://localhost:3000/api/auth/login');
    const authRes = await middleware(authReq);
    expect(authRes.status).toBe(200);
  });

  it('allows authenticated users to access protected pages and APIs', async () => {
    const encrypted = encryptSession(mockSession);
    const req = new NextRequest('http://localhost:3000/schedule', {
      headers: {
        cookie: `nova_session=${encrypted}`,
      },
    });
    const res = await middleware(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('redirects authenticated users away from /login to dashboard or return destination', async () => {
    const encrypted = encryptSession(mockSession);
    const req = new NextRequest('http://localhost:3000/login', {
      headers: {
        cookie: `nova_session=${encrypted}`,
      },
    });
    const res = await middleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/');

    const redirectReq = new NextRequest('http://localhost:3000/login?redirect=/diary', {
      headers: {
        cookie: `nova_session=${encrypted}`,
      },
    });
    const redirectRes = await middleware(redirectReq);
    expect(redirectRes.status).toBe(307);
    expect(redirectRes.headers.get('location')).toBe('http://localhost:3000/diary');
  });

  it('allows all requests when AUTH_DISABLED is true', async () => {
    process.env.AUTH_DISABLED = 'true';
    const req = new NextRequest('http://localhost:3000/');
    const res = await middleware(req);

    expect(res.status).toBe(200);
  });

  describe('agent API bearer path', () => {
    const url = 'http://localhost:3000/api/agent/v1/today';
    const token = `nova_agt_${'A1_-'.repeat(11).slice(0, 43)}`;

    it('returns 401 invalid_token without an Authorization header', async () => {
      const res = await middleware(new NextRequest(url));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_token' });
    });

    it('returns 401 even with a valid session cookie', async () => {
      const req = new NextRequest(url, {
        headers: { cookie: `nova_session=${encryptSession(mockSession)}` },
      });
      const res = await middleware(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_token' });
    });

    it('returns 401 even when AUTH_DISABLED is true', async () => {
      process.env.AUTH_DISABLED = 'true';
      const res = await middleware(new NextRequest(url));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'invalid_token' });
    });

    it('passes through with a well-formed bearer token', async () => {
      expect(token).toHaveLength(9 + 43);
      const res = await middleware(
        new NextRequest(url, { headers: { authorization: `Bearer ${token}` } })
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-next')).toBe('1');
    });

    const malformed: Array<[string, string]> = [
      ['wrong prefix', `Bearer other_${'a'.repeat(43)}`],
      ['too short', `Bearer nova_agt_${'a'.repeat(42)}`],
      ['too long', `Bearer nova_agt_${'a'.repeat(44)}`],
      ['bad characters', `Bearer nova_agt_${'a'.repeat(42)}!`],
      ['non-bearer scheme', `Basic nova_agt_${'a'.repeat(43)}`],
    ];
    for (const [name, header] of malformed) {
      it(`rejects malformed token: ${name}`, async () => {
        const res = await middleware(
          new NextRequest(url, { headers: { authorization: header } })
        );
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'invalid_token' });
      });
    }

    it('does not apply to /api/agent-admin/ (cookie-gated)', async () => {
      const adminUrl = 'http://localhost:3000/api/agent-admin/tokens';
      const noCookie = await middleware(new NextRequest(adminUrl));
      expect(noCookie.status).toBe(401);
      expect((await noCookie.json()).error).toBe('Unauthorized');

      const bearerOnly = await middleware(
        new NextRequest(adminUrl, { headers: { authorization: `Bearer ${token}` } })
      );
      expect(bearerOnly.status).toBe(401);
      expect((await bearerOnly.json()).error).toBe('Unauthorized');

      const withCookie = await middleware(
        new NextRequest(adminUrl, {
          headers: { cookie: `nova_session=${encryptSession(mockSession)}` },
        })
      );
      expect(withCookie.status).toBe(200);
    });
  });
});
