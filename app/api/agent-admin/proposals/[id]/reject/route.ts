import { adminPath, decisionResponse, invalidRequest, readAdminJson, withAdminRoute } from '@/lib/agent/admin-route';
import { MAX_REJECT_REASON_LENGTH, rejectProposal } from '@/lib/agent/approvals';
import { isPlainObject, unknownKey } from '@/lib/agent/domains/validate';
import { badId, isSafeId } from '@/lib/agent/read/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/agent-admin/proposals/:id/reject `{ reason? }` (owner only): pending -> rejected. */
export const POST = withAdminRoute<{ id: string }>(async (request, admin, { id }) => {
  if (!isSafeId(id)) return badId('Invalid proposal id.');
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const raw = body.value;
  if (!isPlainObject(raw)) return invalidRequest('The request body must be a JSON object.');
  const extra = unknownKey(raw, ['reason']);
  if (extra !== null) return invalidRequest(`Unknown body field ${JSON.stringify(extra.slice(0, 40))}.`);
  const reason = raw.reason;
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > MAX_REJECT_REASON_LENGTH)) {
    return invalidRequest(`reason, when present, must be a string of at most ${MAX_REJECT_REASON_LENGTH} characters.`);
  }
  const outcome = await rejectProposal(id, { reason: reason as string | undefined }, { email: admin.email, path: adminPath(request) });
  return decisionResponse(outcome);
});
