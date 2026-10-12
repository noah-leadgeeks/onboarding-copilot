import { withAgentRoute } from '@/lib/agent/auth';
import { cancelProposal, proposalOutcomeResponse } from '@/lib/agent/proposals';
import { badId, isSafeId } from '@/lib/agent/read/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/agent/v1/proposals/:id/cancel : cancels the calling token's own pending proposal. */
export const POST = withAgentRoute<{ id: string }>(
  async (_request, ctx, { params }) => {
    const { id } = await params;
    if (!isSafeId(id)) return badId('Invalid proposal id.');
    const outcome = await cancelProposal(ctx.tokenId, id);
    if (outcome.ok) ctx.audit.proposalId = outcome.proposal.id;
    else if (outcome.status === 409) ctx.audit.proposalId = id;
    ctx.audit.details = outcome.ok ? { status: 'cancelled' } : { error: outcome.error };
    return proposalOutcomeResponse(outcome);
  },
  { scope: 'any-propose', kind: 'proposal', action: 'cancel' }
);
