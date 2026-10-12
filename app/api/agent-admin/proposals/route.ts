import { withAdminRoute } from '@/lib/agent/admin-route';
import { countAdminProposals, listAdminProposals } from '@/lib/agent/approvals';
import { agentJson } from '@/lib/agent/http';
import { isProposalStatus } from '@/lib/agent/proposals';
import { badQuery, parseQuery } from '@/lib/agent/read/query';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOOLEAN_FLAGS: Readonly<Record<string, boolean>> = { '1': true, true: true, '0': false, false: false };

/**
 * GET /api/agent-admin/proposals?status=&countOnly= (owner only). Lists proposals across tokens with
 * the before/changes diff, warnings, ratingsSource, token name, expiresAt and expectedUpdatedAt.
 * `countOnly=1` returns `{ count }` (pending counts unexpired rows only) for the nav badge.
 */
export const GET = withAdminRoute(async (request) => {
  const query = parseQuery(request, ['status', 'countOnly']);
  if (!query.ok) return query.response;
  const { status, countOnly } = query.value;
  if (status !== undefined && !isProposalStatus(status)) {
    return badQuery('status must be one of pending, executed, failed, rejected, cancelled, expired.');
  }
  if (countOnly !== undefined && !(countOnly in BOOLEAN_FLAGS)) {
    return badQuery('countOnly must be 1, true, 0 or false.');
  }
  if (countOnly !== undefined && BOOLEAN_FLAGS[countOnly]) {
    return agentJson({ count: await countAdminProposals(db, status ?? 'pending') });
  }
  return agentJson({ proposals: await listAdminProposals(db, { status }) });
});
