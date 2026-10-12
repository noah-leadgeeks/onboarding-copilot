import { withAgentRoute } from '@/lib/agent/auth';
import { agentError, agentJson } from '@/lib/agent/http';
import {
  createProposal,
  isProposalStatus,
  listProposals,
  MAX_PROPOSAL_BODY_BYTES,
  proposalOutcomeResponse,
} from '@/lib/agent/proposals';
import { badQuery, parseQuery, readFromDatabase } from '@/lib/agent/read/query';
import type { AuditDetails } from '@/lib/agent/audit';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/agent/v1/proposals?status= : the calling token's proposals, newest first. */
export const GET = withAgentRoute(
  async (request, ctx) => {
    const query = parseQuery(request, ['status']);
    if (!query.ok) return query.response;
    const status = query.value.status;
    if (status !== undefined && !isProposalStatus(status)) {
      return badQuery('status must be one of pending, executed, failed, rejected, cancelled, expired.');
    }
    const list = await readFromDatabase('proposals', () => listProposals(db, ctx.tokenId, { status }));
    if (!list.ok) return list.response;
    return agentJson({ proposals: list.value });
  },
  { scope: 'proposals:read', kind: 'read', action: 'read.proposals' }
);

async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_PROPOSAL_BODY_BYTES) {
    return { ok: false, response: agentError(422, 'invalid_proposal', `The request body exceeds ${MAX_PROPOSAL_BODY_BYTES} bytes.`) };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, response: agentError(422, 'invalid_proposal', 'The request body must be valid JSON.') };
  }
}

/**
 * POST /api/agent/v1/proposals: records a pending proposal (202), or replays an idempotent one
 * (200). Any `:propose` scope passes the wrapper; the per-domain scope is checked inside (S4).
 */
export const POST = withAgentRoute(
  async (request, ctx) => {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const result = await createProposal({ tokenId: ctx.tokenId, scopes: ctx.scopes }, body.value);
    if (result.domain && result.operation) ctx.audit.action = `propose.${result.domain}.${result.operation}`;
    const details: AuditDetails = {};
    if (result.domain) details.domain = result.domain;
    if (result.fields) details.fields = result.fields;
    if (result.warnings !== undefined) details.warnings = result.warnings;
    if (result.outcome.ok) {
      ctx.audit.proposalId = result.outcome.proposal.id;
      details.replayed = result.outcome.replayed;
    } else {
      details.error = result.outcome.error;
    }
    ctx.audit.details = details;
    return proposalOutcomeResponse(result.outcome);
  },
  { scope: 'any-propose', kind: 'proposal', action: 'propose.request' }
);
