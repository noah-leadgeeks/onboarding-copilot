import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decryptSessionWebCrypto, isSessionValid } from '@/lib/auth/edge-session';

// Agent API bearer tokens: `nova_agt_` + 43 base64url chars. Format check only
// (no DB access in the edge runtime); the route handler verifies the token.
const AGENT_TOKEN_RE = /^Bearer nova_agt_[A-Za-z0-9_-]{43}$/;

const PUBLIC_EXACT_PATHS = new Set(['/login', '/api/health']);

const PUBLIC_PATH_PREFIXES = [
  '/api/auth/',
  '/_next/',
  '/favicon.ico',
  '/icon.svg',
  '/apple-icon.svg',
];

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // 0. Agent API: bearer-only. Cookies and AUTH_DISABLED never apply here.
  if (pathname.startsWith('/api/agent/')) {
    const authorization = request.headers.get('authorization') ?? '';
    if (AGENT_TOKEN_RE.test(authorization)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  // 1. If authentication is explicitly disabled via env, allow all traffic
  if (process.env.AUTH_DISABLED === 'true') {
    return NextResponse.next();
  }

  // 2. Allow public path prefixes
  for (const prefix of PUBLIC_PATH_PREFIXES) {
    if (pathname.startsWith(prefix)) {
      return NextResponse.next();
    }
  }

  // 3. Extract and validate session cookie
  const sessionCookie = request.cookies.get('nova_session')?.value;
  let isAuthenticated = false;

  if (sessionCookie) {
    try {
      const session = await decryptSessionWebCrypto(sessionCookie);
      isAuthenticated = isSessionValid(session);
    } catch {
      isAuthenticated = false;
    }
  }

  // 4. If visiting /login:
  if (pathname === '/login') {
    // If already authenticated, redirect to destination or dashboard
    if (isAuthenticated) {
      const redirectTo =
        request.nextUrl.searchParams.get('redirect') ||
        request.nextUrl.searchParams.get('returnTo') ||
        '/';
      const safeRedirect =
        redirectTo.startsWith('/') && !redirectTo.startsWith('//')
          ? redirectTo
          : '/';
      return NextResponse.redirect(new URL(safeRedirect, request.url));
    }
    // Otherwise allow viewing /login
    return NextResponse.next();
  }

  // 5. Allow other public exact paths
  if (PUBLIC_EXACT_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // 6. If authenticated, allow access to protected page or API
  if (isAuthenticated) {
    return NextResponse.next();
  }

  // 7. If NOT authenticated:
  // For API routes, return 401 Unauthorized JSON
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        error: 'Unauthorized',
        message: 'Authentication required. Please sign in.',
        loginUrl: '/login',
      },
      { status: 401 }
    );
  }

  // For UI pages (e.g. '/', '/schedule', '/diary', '/settings', etc.), redirect to /login
  const loginUrl = new URL('/login', request.url);
  if (pathname !== '/') {
    loginUrl.searchParams.set('redirect', pathname + search);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except static files with extensions (.png, .jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
