import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db, isDbConfigured } from '@/lib/db';
import { agentTokens } from '@/lib/db/schema';
import { recordAudit, updateAudit, type AuditDetails } from './audit';
import { AUTH_FAILED_AUDIT_CAP_PER_MIN, RATE_LIMIT_RETRY_AFTER_SECONDS } from './config';
import { describeError, isUndefinedTableError } from './errors';
import { agentError, withNoStore } from './http';
import { actionMatchesKind, checkRateLimit, countRecentAuthFailures, type AgentActionKind } from './rate-limit';
import { hasScope, parseScopes, type AgentScope } from './scopes';
import { extractBearer, isValidTokenFormat } from './token-format';
import { hashAgentToken } from './tokens';

export interface AgentContext {
  tokenId: string;
  tokenName: string;
  tokenPrefix: string;
  scopes: AgentScope[];
  expiresAt: string | null;
}

export type AuthFailureReason = 'missing' | 'malformed' | 'unknown' | 'revoked' | 'expired';

export type AgentAuthResult =
  | { ok: true; ctx: AgentContext }
  | { ok: false; response: Response; reason: AuthFailureReason | 'no_database' };

/** Selection used by the token lookup; revocation and expiry are evaluated in SQL (database clock). */
export const TOKEN_AUTH_SELECTION = {
  id: agentTokens.id,
  name: agentTokens.name,
  tokenPrefix: agentTokens.tokenPrefix,
  scopes: agentTokens.scopes,
  expiresAt: agentTokens.expiresAt,
  revoked: sql<boolean>`(${agentTokens.revokedAt} IS NOT NULL)`,
  expired: sql<boolean>`(${agentTokens.expiresAt} IS NOT NULL AND ${agentTokens.expiresAt} <= now())`,
};

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return '';
  }
}

function invalidToken(): Response {
  return agentError(401, 'invalid_token', 'Missing, malformed, unknown, revoked or expired agent token.');
}

/**
 * Writes an `auth.failed` row unless 20 or more were written in the last minute (S1), in which case
 * it only warns. Throws only for `42P01` (tables missing) so the caller can map it to 503.
 */
async function recordAuthFailure(
  request: Request,
  reason: AuthFailureReason,
  presented: string | null,
  tokenId: string | null
): Promise<void> {
  let recent: number;
  try {
    recent = await countRecentAuthFailures(db);
  } catch (error) {
    if (isUndefinedTableError(error)) throw error;
    console.warn(`[agent-auth] auth.failed count failed: ${describeError(error)}`);
    return;
  }
  if (recent >= AUTH_FAILED_AUDIT_CAP_PER_MIN) {
    console.warn(`[agent-auth] auth.failed audit cap reached (${AUTH_FAILED_AUDIT_CAP_PER_MIN}/min); not recording`);
    return;
  }
  const result = await recordAudit(db, {
    actor: 'agent',
    action: 'auth.failed',
    tokenId,
    tokenPrefix: presented,
    method: request.method,
    path: requestPath(request),
    statusCode: 401,
    details: { reason },
  });
  if (!result.ok && isUndefinedTableError(result.error)) throw result.error;
}

/**
 * Authenticates `Authorization: Bearer nova_agt_...` against `agent_tokens` (sha256 lookup).
 * 503 when no database is configured; 401 `invalid_token` for missing/malformed/unknown/revoked/
 * expired tokens. Updates `last_used_at` at most once per minute. May throw database errors
 * (including `42P01`); `withAgentRoute` maps them.
 */
export async function authenticateAgentRequest(request: Request): Promise<AgentAuthResult> {
  if (!isDbConfigured()) {
    return {
      ok: false,
      reason: 'no_database',
      response: agentError(503, 'agent_api_requires_database', 'The agent API requires a configured database.'),
    };
  }

  const header = request.headers.get('authorization');
  const presented = extractBearer(header);
  if (!header || !header.trim()) {
    await recordAuthFailure(request, 'missing', null, null);
    return { ok: false, reason: 'missing', response: invalidToken() };
  }
  if (!presented || !isValidTokenFormat(presented)) {
    await recordAuthFailure(request, 'malformed', presented, null);
    return { ok: false, reason: 'malformed', response: invalidToken() };
  }

  const rows = await db
    .select(TOKEN_AUTH_SELECTION)
    .from(agentTokens)
    .where(eq(agentTokens.tokenHash, hashAgentToken(presented)))
    .limit(1);
  const token = rows[0];
  if (!token) {
    await recordAuthFailure(request, 'unknown', presented, null);
    return { ok: false, reason: 'unknown', response: invalidToken() };
  }
  if (token.revoked) {
    await recordAuthFailure(request, 'revoked', presented, token.id);
    return { ok: false, reason: 'revoked', response: invalidToken() };
  }
  if (token.expired) {
    await recordAuthFailure(request, 'expired', presented, token.id);
    return { ok: false, reason: 'expired', response: invalidToken() };
  }

  try {
    await db
      .update(agentTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(agentTokens.id, token.id),
          or(isNull(agentTokens.lastUsedAt), lt(agentTokens.lastUsedAt, sql`now() - interval '1 minute'`))
        )
      );
  } catch (error) {
    if (isUndefinedTableError(error)) throw error;
    console.warn(`[agent-auth] last_used_at update failed: ${describeError(error)}`);
  }

  return {
    ok: true,
    ctx: {
      tokenId: token.id,
      tokenName: token.name,
      tokenPrefix: token.tokenPrefix,
      scopes: parseScopes(token.scopes) ?? [],
      expiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// withAgentRoute
// ---------------------------------------------------------------------------------------------

/** Marker set on every handler produced by `withAgentRoute`; the guard test checks for it. */
export const AGENT_ROUTE_MARKER = Symbol.for('nova.agent.withAgentRoute');

/** Mutable audit fields a handler may refine before the row is finalized. */
export interface AgentAuditHandle {
  readonly id: string;
  /** Must stay in the route's action class (`read.*`, or `propose.*`/`cancel`). */
  action: string;
  details?: AuditDetails;
  proposalId?: string;
}

export interface AgentRouteContext extends AgentContext {
  audit: AgentAuditHandle;
}

export type AgentScopeOption = string | ((ctx: AgentContext, request: Request) => string | Promise<string>);
export type AgentActionOption = string | ((ctx: AgentContext, request: Request) => string | Promise<string>);

export interface AgentRouteOptions {
  /** A scope, `'any'`, `'any-propose'`, or a function deriving the scope from the request. */
  scope: AgentScopeOption;
  kind: AgentActionKind;
  /** Audit action, e.g. `read.diary`; must belong to `kind`'s class. */
  action: AgentActionOption;
}

export interface AgentRouteParams<P> {
  params: Promise<P>;
}

export type AgentRouteHandler<P> = (
  request: Request,
  ctx: AgentRouteContext,
  routeContext: AgentRouteParams<P>
) => Promise<Response>;

export type WrappedAgentRoute<P> = ((request: Request, routeContext: AgentRouteParams<P>) => Promise<Response>) & {
  readonly [AGENT_ROUTE_MARKER]: true;
};

export function isAgentRoute(value: unknown): boolean {
  return typeof value === 'function' && (value as unknown as Record<symbol, unknown>)[AGENT_ROUTE_MARKER] === true;
}

function tablesMissing(): Response {
  console.warn('[agent-api] agent tables are missing (42P01); run the 0001_agent_access migration');
  return agentError(503, 'agent_tables_missing', 'Agent access is not set up on this database.');
}

function internalError(): Response {
  return agentError(500, 'internal_error', 'Internal error.');
}

/**
 * Wraps an agent route: auth -> scope (403 audited as `insufficient_scope`) -> reserve audit row ->
 * rate limit -> handler -> finalize audit (status, duration). Handler throws become 500 with no
 * message stored. Any `42P01` becomes 503 `agent_tables_missing` (M11). Always `no-store`.
 */
export function withAgentRoute<P = Record<string, string>>(
  handler: AgentRouteHandler<P>,
  options: AgentRouteOptions
): WrappedAgentRoute<P> {
  if (typeof options.action === 'string' && !actionMatchesKind(options.action, options.kind)) {
    throw new Error(`withAgentRoute: action "${options.action}" does not belong to the ${options.kind} class`);
  }

  const wrapped = async (request: Request, routeContext: AgentRouteParams<P>): Promise<Response> => {
    const started = Date.now();
    const path = requestPath(request);
    let auditId: string | null = null;

    const finalize = async (patch: Parameters<typeof updateAudit>[2]) => {
      if (!auditId) return;
      await updateAudit(db, auditId, { durationMs: Date.now() - started, ...patch });
    };

    try {
      const auth = await authenticateAgentRequest(request);
      if (!auth.ok) return withNoStore(auth.response);
      const base = auth.ctx;

      const required = typeof options.scope === 'function' ? await options.scope(base, request) : options.scope;
      if (!hasScope(base.scopes, required)) {
        const denied = await recordAudit(db, {
          actor: 'agent',
          action: 'insufficient_scope',
          tokenId: base.tokenId,
          tokenPrefix: base.tokenPrefix,
          method: request.method,
          path,
          statusCode: 403,
          durationMs: Date.now() - started,
          details: { requiredScope: required },
        });
        if (!denied.ok && isUndefinedTableError(denied.error)) return tablesMissing();
        return agentError(403, 'insufficient_scope', `This token lacks the ${required} scope.`);
      }

      const action = typeof options.action === 'function' ? await options.action(base, request) : options.action;
      if (!actionMatchesKind(action, options.kind)) {
        throw new Error('withAgentRoute: resolved action does not belong to the route class');
      }

      const reserved = await recordAudit(db, {
        actor: 'agent',
        action,
        tokenId: base.tokenId,
        tokenPrefix: base.tokenPrefix,
        method: request.method,
        path,
      });
      if (!reserved.ok) {
        if (isUndefinedTableError(reserved.error)) return tablesMissing();
        // Without an audit row the rate limit cannot be enforced: fail closed.
        return agentError(500, 'database_error', 'Could not record the request.');
      }
      auditId = reserved.id;

      const decision = await checkRateLimit(db, base.tokenId, options.kind);
      if (decision.limited) {
        await finalize({ action: 'rate_limited', statusCode: 429, details: { limitedAction: action, limit: decision.limit } });
        return agentError(429, 'rate_limited', 'Too many requests; retry later.', {
          'Retry-After': String(RATE_LIMIT_RETRY_AFTER_SECONDS),
        });
      }

      const audit: AgentAuditHandle = { id: reserved.id, action };
      const ctx: AgentRouteContext = { ...base, audit };
      let response: Response;
      try {
        response = await handler(request, ctx, routeContext);
      } catch (error) {
        if (isUndefinedTableError(error)) throw error;
        console.error(`[agent-api] handler for ${action} threw: ${describeError(error)}`);
        response = internalError();
      }

      const finalAction = actionMatchesKind(audit.action, options.kind) ? audit.action : action;
      await finalize({
        action: finalAction === action ? undefined : finalAction,
        statusCode: response.status,
        details: audit.details,
        proposalId: audit.proposalId,
      });
      return withNoStore(response);
    } catch (error) {
      if (isUndefinedTableError(error)) {
        await finalize({ statusCode: 503 });
        return tablesMissing();
      }
      console.error(`[agent-api] request failed: ${describeError(error)}`);
      await finalize({ statusCode: 500 });
      return internalError();
    }
  };

  Object.defineProperty(wrapped, AGENT_ROUTE_MARKER, { value: true, enumerable: false });
  return wrapped as WrappedAgentRoute<P>;
}
