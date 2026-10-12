import { withAdminRoute } from '@/lib/agent/admin-route';
import { agentJson } from '@/lib/agent/http';
import { badQuery, isSafeId, parseQuery } from '@/lib/agent/read/query';
import { AUDIT_MAX_LIMIT, listAuditRows, parseAuditLimit } from '@/lib/agent/tokens-admin';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/agent-admin/audit?tokenId=&limit= (owner only): newest audit rows first. `limit` defaults
 * to 50 and is capped at 200. A missing agent table is 200 `{ ok: false, error: 'agent_tables_missing' }`.
 */
export const GET = withAdminRoute(async (request) => {
  const query = parseQuery(request, ['tokenId', 'limit']);
  if (!query.ok) return query.response;
  const { tokenId, limit: rawLimit } = query.value;
  if (tokenId !== undefined && !isSafeId(tokenId)) return badQuery('tokenId is not a valid token id.');
  const limit = parseAuditLimit(rawLimit);
  if (limit === null) return badQuery(`limit must be a whole number from 1 (values above ${AUDIT_MAX_LIMIT} are capped).`);
  return agentJson({ rows: await listAuditRows(db, { tokenId, limit }) });
});
