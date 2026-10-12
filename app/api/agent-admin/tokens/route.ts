import { adminPath, invalidRequest, readAdminJson, withAdminRoute } from '@/lib/agent/admin-route';
import { getAgentConfig } from '@/lib/agent/config';
import { agentJson } from '@/lib/agent/http';
import { parseQuery } from '@/lib/agent/read/query';
import { issueAgentToken, listAgentTokens, parseIssueTokenBody } from '@/lib/agent/tokens-admin';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/agent-admin/tokens (owner only): `{ tokens, defaultExpiresInDays }`. Never returns the
 * token hash. A missing agent table is 200 `{ ok: false, error: 'agent_tables_missing' }` (M11).
 */
export const GET = withAdminRoute(async (request) => {
  const query = parseQuery(request, []);
  if (!query.ok) return query.response;
  const tokens = await listAgentTokens(db);
  return agentJson({ tokens, defaultExpiresInDays: getAgentConfig().tokenDefaultTtlDays });
});

/**
 * POST /api/agent-admin/tokens `{ name, scopes[], expiresInDays? }` (owner only): 201 with the
 * plaintext `token` exactly once plus the stored view; audited as `token.issue`.
 */
export const POST = withAdminRoute(async (request, admin) => {
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const parsed = parseIssueTokenBody(body.value);
  if (!parsed.ok) return invalidRequest(parsed.message);
  const issued = await issueAgentToken(db, parsed.value, admin.email, { path: adminPath(request) });
  return agentJson({ token: issued.token, tokenInfo: issued.view }, { status: 201 });
});
