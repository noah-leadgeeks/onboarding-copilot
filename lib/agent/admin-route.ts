/**
 * Shared plumbing for `/api/agent-admin/*` routes: owner gate, database checks, JSON body parsing,
 * error mapping and the `{ ok, data }` / `{ ok: false, error, message }` envelope (no-store).
 */
import { isDbConfigured } from '@/lib/db';
import { requireAdminSession, type AdminIdentity } from './admin-auth';
import type { DecisionOutcome } from './approvals';
import { describeError, isUndefinedTableError } from './errors';
import { agentError, agentJson } from './http';

export const MAX_ADMIN_BODY_BYTES = 16 * 1024;

export type AdminHandler<P> = (request: Request, admin: AdminIdentity, params: P) => Promise<Response>;

function requestPath(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return '';
  }
}

/**
 * Runs `handler` after `requireAdminSession` and the database check. A missing agent table
 * (`42P01`) is 200 `{ ok: false, error: 'agent_tables_missing' }` for GET (the Settings card and
 * badge degrade quietly, M11) and 503 for mutations; any other error is a log-safe 500.
 */
export function withAdminRoute<P = Record<string, string>>(handler: AdminHandler<P>) {
  return async (request: Request, context: { params: Promise<P> }): Promise<Response> => {
    const auth = requireAdminSession(request);
    if (!auth.ok) return auth.response;
    if (!isDbConfigured()) {
      return agentError(503, 'agent_api_requires_database', 'Agent access requires DATABASE_URL.');
    }
    try {
      const params = await context.params;
      return await handler(request, auth.admin, params);
    } catch (error) {
      if (isUndefinedTableError(error)) {
        console.warn('[agent-admin] agent tables are missing; run the 0001_agent_access migration');
        const message = 'Agent access is not set up on this database.';
        if (request.method.toUpperCase() === 'GET') {
          return Response.json(
            { ok: false, error: 'agent_tables_missing', message },
            { status: 200, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        return agentError(503, 'agent_tables_missing', message);
      }
      console.warn(`[agent-admin] ${request.method} ${requestPath(request)} failed: ${describeError(error)}`);
      return agentError(500, 'internal_error', 'The request failed.');
    }
  };
}

export async function readAdminJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_ADMIN_BODY_BYTES) {
    return { ok: false, response: agentError(413, 'body_too_large', `The request body exceeds ${MAX_ADMIN_BODY_BYTES} bytes.`) };
  }
  if (text.trim().length === 0) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: agentError(400, 'invalid_request', 'The request body must be valid JSON.') };
  }
}

export function invalidRequest(message: string): Response {
  return agentError(400, 'invalid_request', message);
}

export function adminPath(request: Request): string {
  return requestPath(request);
}

/** Approve/reject outcome as JSON: `data` holds the decision; errors carry `status` and `proposal`. */
export function decisionResponse(outcome: DecisionOutcome): Response {
  if (outcome.ok) {
    const data: Record<string, unknown> = { status: outcome.status, idempotent: outcome.idempotent, proposal: outcome.proposal };
    if (outcome.status === 'executed') data.after = outcome.after ?? null;
    return agentJson(data);
  }
  const body: Record<string, unknown> = { ok: false, error: outcome.error, message: outcome.message };
  if (outcome.status !== undefined) body.status = outcome.status;
  if (outcome.proposal !== undefined) body.proposal = outcome.proposal;
  return Response.json(body, { status: outcome.httpStatus, headers: { 'Cache-Control': 'no-store' } });
}
