/**
 * Owner-only gate for `/api/agent-admin/*` (plan "Admin routes", B1, S6, S7). Six checks, in order:
 *
 * 1. Any `Authorization` header -> 400 `bearer_not_allowed` (agent tokens never reach admin routes).
 * 2. `AUTH_DISABLED=true` in production (`VERCEL=1` or `NODE_ENV=production`) -> 503.
 * 3. Neither `AUTH_SECRET` nor `GOOGLE_CLIENT_SECRET` set (forgeable cookie) -> 503.
 * 4. Mutating methods: `Content-Type: application/json` (415), same-origin `Origin` and no
 *    `Sec-Fetch-Site: cross-site` (403 `bad_origin`).
 * 5. Session cookie: `deserializeSessionCookie` + `isSessionValid` (401). Never
 *    `resolveActiveSession`, so no Google token refresh per admin request or badge poll.
 *    Under `AUTH_DISABLED=true` (local only, check 2) the identity is `'local'`.
 * 6. `AGENT_ADMIN_EMAILS` (comma-separated, trimmed, lower-cased) must be non-empty (403
 *    `admin_allowlist_unset`) and contain the lower-cased session email (403 `not_owner`).
 *    `'local'` is accepted only under `AUTH_DISABLED=true`.
 */
import { isSessionValid } from '@/lib/auth/edge-session';
import { deserializeSessionCookie, NOVA_SESSION_COOKIE } from '@/lib/auth/session';
import { agentError } from './http';

export const LOCAL_ADMIN_IDENTITY = 'local';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AdminIdentity {
  /** Lower-cased session email, or `'local'` under `AUTH_DISABLED=true`. */
  email: string;
  local: boolean;
}

export type AdminAuthResult = { ok: true; admin: AdminIdentity } | { ok: false; response: Response };

function deny(status: number, error: string, message: string): AdminAuthResult {
  return { ok: false, response: agentError(status, error, message) };
}

/** Parsed `AGENT_ADMIN_EMAILS`: trimmed, lower-cased, empty entries dropped. */
export function adminAllowlist(raw: string | undefined = process.env.AGENT_ADMIN_EMAILS): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function requestHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  try {
    hosts.add(new URL(request.url).host.toLowerCase());
  } catch {
    // An unparsable URL contributes no host; a present Origin then cannot match.
  }
  const host = request.headers.get('host');
  if (host) hosts.add(host.trim().toLowerCase());
  return hosts;
}

function originMatches(request: Request, origin: string): boolean {
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false; // includes the literal "null" origin
  }
  return originHost.length > 0 && requestHosts(request).has(originHost);
}

export function requireAdminSession(request: Request): AdminAuthResult {
  // 1. Agent bearer tokens (or any Authorization header) are never accepted here.
  if (request.headers.has('authorization')) {
    return deny(400, 'bearer_not_allowed', 'Admin routes accept the owner session cookie only, never an Authorization header.');
  }

  // 2. AUTH_DISABLED must never be active in production.
  const authDisabled = process.env.AUTH_DISABLED === 'true';
  if (authDisabled && (process.env.VERCEL === '1' || process.env.NODE_ENV === 'production')) {
    return deny(503, 'auth_disabled_in_production', 'AUTH_DISABLED is set in production; admin routes are unavailable.');
  }

  // 3. Without a real secret the session cookie key is a public fallback and can be forged.
  if (!process.env.AUTH_SECRET && !process.env.GOOGLE_CLIENT_SECRET) {
    return deny(503, 'auth_secret_required', 'AUTH_SECRET (or GOOGLE_CLIENT_SECRET) must be set to use admin routes.');
  }

  // 4. CSRF defenses for mutating requests.
  if (MUTATING_METHODS.has(request.method.toUpperCase())) {
    if (!isJsonContentType(request.headers.get('content-type'))) {
      return deny(415, 'unsupported_media_type', 'Content-Type must be application/json.');
    }
    const origin = request.headers.get('origin');
    if (origin !== null && !originMatches(request, origin)) {
      return deny(403, 'bad_origin', 'Cross-origin admin requests are not allowed.');
    }
    if ((request.headers.get('sec-fetch-site') ?? '').toLowerCase() === 'cross-site') {
      return deny(403, 'bad_origin', 'Cross-site admin requests are not allowed.');
    }
  }

  // 5. Session.
  let email: string;
  if (authDisabled) {
    email = LOCAL_ADMIN_IDENTITY;
  } else {
    const session = deserializeSessionCookie(readCookie(request.headers.get('cookie'), NOVA_SESSION_COOKIE));
    if (!session || !isSessionValid(session)) {
      return deny(401, 'unauthenticated', 'Sign in to use admin routes.');
    }
    email = typeof session.user.email === 'string' ? session.user.email.trim().toLowerCase() : '';
  }

  // 6. Owner allowlist, fail-closed.
  const allowlist = adminAllowlist();
  if (allowlist.length === 0) {
    return deny(403, 'admin_allowlist_unset', 'AGENT_ADMIN_EMAILS is not configured; admin routes are disabled.');
  }
  if (authDisabled) return { ok: true, admin: { email, local: true } };
  if (email.length === 0 || email === LOCAL_ADMIN_IDENTITY || !allowlist.includes(email)) {
    return deny(403, 'not_owner', 'This account is not allowed to manage agent access.');
  }
  return { ok: true, admin: { email, local: false } };
}
