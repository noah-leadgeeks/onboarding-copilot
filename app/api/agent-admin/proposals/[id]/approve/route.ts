import { adminPath, decisionResponse, invalidRequest, readAdminJson, withAdminRoute } from '@/lib/agent/admin-route';
import { approveProposal } from '@/lib/agent/approvals';
import { isPlainObject, unknownKey } from '@/lib/agent/domains/validate';
import { badId, isSafeId } from '@/lib/agent/read/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_EXPECTED_LENGTH = 64;

/**
 * POST /api/agent-admin/proposals/:id/approve `{ expectedUpdatedAt, acknowledgeWarnings? }` (owner
 * only): approve and execute in one transaction (DB only). `expectedUpdatedAt` is the value the UI
 * rendered (string or null) and must be present.
 */
export const POST = withAdminRoute<{ id: string }>(async (request, admin, { id }) => {
  if (!isSafeId(id)) return badId('Invalid proposal id.');
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const raw = body.value;
  if (!isPlainObject(raw)) return invalidRequest('The request body must be a JSON object.');
  const extra = unknownKey(raw, ['expectedUpdatedAt', 'acknowledgeWarnings']);
  if (extra !== null) return invalidRequest(`Unknown body field ${JSON.stringify(extra.slice(0, 40))}.`);
  const expected = raw.expectedUpdatedAt;
  if (!('expectedUpdatedAt' in raw) || (expected !== null && (typeof expected !== 'string' || expected.length > MAX_EXPECTED_LENGTH))) {
    return invalidRequest('expectedUpdatedAt is required: the string (or null) shown with the proposal.');
  }
  const acknowledge = raw.acknowledgeWarnings;
  if (acknowledge !== undefined && typeof acknowledge !== 'boolean') {
    return invalidRequest('acknowledgeWarnings, when present, must be a boolean.');
  }
  const outcome = await approveProposal(
    id,
    { expectedUpdatedAt: expected as string | null, acknowledgeWarnings: acknowledge === true },
    { email: admin.email, path: adminPath(request) }
  );
  return decisionResponse(outcome);
});
