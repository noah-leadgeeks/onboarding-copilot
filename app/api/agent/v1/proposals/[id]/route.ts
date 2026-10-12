import { withAgentRoute } from '@/lib/agent/auth';
import { agentJson } from '@/lib/agent/http';
import { getProposal } from '@/lib/agent/proposals';
import { badId, isSafeId, notFound, parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/proposals/:id : one of the calling token's own proposals. */
export const GET = withAgentRoute<{ id: string }>(
  async (request, ctx, { params }) => {
    const query = parseQuery(request, []);
    if (!query.ok) return query.response;
    const { id } = await params;
    if (!isSafeId(id)) return badId('Invalid proposal id.');
    const proposal = await readFromDatabase('proposal', () => getProposal(db, ctx.tokenId, id));
    if (!proposal.ok) return proposal.response;
    if (!proposal.value) return notFound('No proposal with this id for this token.');
    ctx.audit.proposalId = proposal.value.id;
    return agentJson(proposal.value);
  },
  { scope: 'proposals:read', kind: 'read', action: 'read.proposals' }
);
