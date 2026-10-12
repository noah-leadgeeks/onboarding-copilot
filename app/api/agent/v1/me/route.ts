import { withAgentRoute } from '@/lib/agent/auth';
import { getAgentConfig } from '@/lib/agent/config';
import { agentJson } from '@/lib/agent/http';
import { parseQuery } from '@/lib/agent/read/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/me: the calling token and the static limits. Any valid token. */
export const GET = withAgentRoute(
  async (request, ctx) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const config = getAgentConfig();
    return agentJson({
      tokenName: ctx.tokenName,
      scopes: ctx.scopes,
      expiresAt: ctx.expiresAt,
      limits: {
        readsPerMin: config.readsPerMin,
        proposalsPerMin: config.proposalsPerMin,
        maxPending: config.maxPending,
      },
    });
  },
  { scope: 'any', kind: 'read', action: 'read.me' }
);
