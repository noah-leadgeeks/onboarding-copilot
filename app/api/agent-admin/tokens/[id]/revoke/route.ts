import { adminPath, invalidRequest, readAdminJson, withAdminRoute } from '@/lib/agent/admin-route';
import { isPlainObject } from '@/lib/agent/domains/validate';
import { agentError, agentJson } from '@/lib/agent/http';
import { badId, isSafeId } from '@/lib/agent/read/query';
import { revokeAgentToken } from '@/lib/agent/tokens-admin';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/agent-admin/tokens/:id/revoke `{}` (owner only). One transaction (`revokeAgentToken`):
 * `UPDATE agent_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL` (the UPDATE's
 * own row lock; never `SELECT ... FOR UPDATE` on the token), then the token's pending proposals are
 * locked `FOR NO KEY UPDATE` and cancelled. Revoking an already revoked token is 200 (idempotent).
 */
export const POST = withAdminRoute<{ id: string }>(async (request, admin, { id }) => {
  if (!isSafeId(id)) return badId('Invalid token id.');
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  if (!isPlainObject(body.value) || Object.keys(body.value).length > 0) {
    return invalidRequest('The request body must be an empty JSON object.');
  }
  const result = await revokeAgentToken(db, id, admin.email, { path: adminPath(request) });
  if (result.status === 'not_found') return agentError(404, 'not_found', 'No agent token has this id.');
  if (result.status === 'already_revoked') return agentJson({ status: 'already_revoked', cancelledProposalIds: [] });
  return agentJson({ status: 'revoked', cancelledProposalIds: result.cancelledProposalIds });
});
