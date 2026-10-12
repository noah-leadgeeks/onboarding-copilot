/**
 * Owner-side approval (plan Step 7, "Approval flow" step 4). `approveProposal` executes a pending
 * proposal in one `db.transaction`; `rejectProposal` marks it rejected. The executor writes the
 * database only, never the spreadsheet (D2).
 *
 * Transaction discipline: every query inside a transaction callback uses `tx` (M5; pool `max: 2`).
 * Lock order is `agent_tokens` -> `agent_proposals` -> target row (M7), and approve never locks the
 * token: it reads `revoked_at` with a plain SELECT. Proposals are locked `FOR NO KEY UPDATE` (M5) so
 * the FK `KEY SHARE` taken by audit inserts from the same or another transaction never conflicts.
 * Staleness is compared in SQL (`IS NOT DISTINCT FROM`, `::timestamptz` for `activities`, M4, S8).
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db';
import { activities, agentProposals, agentTokens, diaryEntries, feedbackEntries, monthlyReviews, timelineStages } from '@/lib/db/schema';
import { recordAudit, type AgentExecutor, type AgentTransaction, type AuditDetails } from './audit';
import { getDomain } from './domains';
import type { DomainModule, JsonObject, JsonValue, ProposalDomain, TargetKey } from './domains/types';
import { describeError } from './errors';
import {
  markExpiredIfNeeded,
  pickTouched,
  PROPOSAL_SELECTION,
  toProposalView,
  type ProposalRow,
  type ProposalStatus,
  type ProposalView,
} from './proposals';

export const MAX_FAILURE_MESSAGE_LENGTH = 500;
export const MAX_REJECT_REASON_LENGTH = 2_000;
export const ADMIN_LIST_LIMIT = 100;

/** Who decides, for `decided_by` and the audit row. */
export interface AdminActor {
  email: string;
  /** Request pathname for the audit row (no query string is stored). */
  path?: string | null;
}

export interface ApproveInput {
  /** The `expectedUpdatedAt` the owner's UI rendered (string or null); must equal the stored one. */
  expectedUpdatedAt: string | null;
  acknowledgeWarnings?: boolean;
}

export interface RejectInput {
  reason?: string;
}

/** Admin view: the agent view plus refresh/decision metadata and, in lists, the token name. */
export interface AdminProposalView extends ProposalView {
  tokenId: string;
  refreshedAt: string | null;
  decidedBy: string | null;
  tokenName?: string;
  tokenPrefix?: string;
}

export type DecisionOutcome =
  | {
      ok: true;
      httpStatus: 200;
      status: 'executed' | 'rejected';
      after?: JsonValue;
      /** True when the proposal was already executed (approve is idempotent, B3). */
      idempotent: boolean;
      proposal: AdminProposalView;
    }
  | {
      ok: false;
      httpStatus: number;
      error: string;
      message: string;
      status?: string;
      proposal?: AdminProposalView;
    };

/** Columns for admin reads and for every proposal row handled here. */
export const ADMIN_PROPOSAL_SELECTION = {
  ...PROPOSAL_SELECTION,
  refreshedAt: agentProposals.refreshedAt,
  decidedBy: agentProposals.decidedBy,
};

type AdminProposalRow = ProposalRow & { refreshedAt: Date | null; decidedBy: string | null };

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function toAdminProposalView(row: AdminProposalRow & { tokenName?: string; tokenPrefix?: string }): AdminProposalView {
  const view: AdminProposalView = {
    ...toProposalView(row),
    tokenId: row.tokenId,
    refreshedAt: isoOrNull(row.refreshedAt ?? null),
    decidedBy: row.decidedBy ?? null,
  };
  if (row.tokenName !== undefined) view.tokenName = row.tokenName;
  if (row.tokenPrefix !== undefined) view.tokenPrefix = row.tokenPrefix;
  return view;
}

/** How the approval transaction finds and locks a domain's target row. */
interface TargetRowSpec {
  table: PgTable;
  keyColumn: PgColumn;
  keyValue(key: TargetKey): string | number;
  updatedAt: PgColumn;
  /** `activities.updated_at` is timestamptz (M4); every other domain stores text. */
  timestamptz: boolean;
  /** `update` needs an existing row (no upsert): schedule and timeline (M6). */
  updateNeedsRow: boolean;
}

const TARGET_ROWS: Readonly<Record<ProposalDomain, TargetRowSpec>> = {
  schedule: {
    table: activities,
    keyColumn: activities.id,
    keyValue: (key) => String(key.id),
    updatedAt: activities.updatedAt,
    timestamptz: true,
    updateNeedsRow: true,
  },
  diary: {
    table: diaryEntries,
    keyColumn: diaryEntries.rowNumber,
    keyValue: (key) => Number(key.rowNumber),
    updatedAt: diaryEntries.updatedAt,
    timestamptz: false,
    updateNeedsRow: false,
  },
  feedback: {
    table: feedbackEntries,
    keyColumn: feedbackEntries.sessionId,
    keyValue: (key) => String(key.sessionId),
    updatedAt: feedbackEntries.updatedAt,
    timestamptz: false,
    updateNeedsRow: false,
  },
  reviews: {
    table: monthlyReviews,
    keyColumn: monthlyReviews.month,
    keyValue: (key) => Number(key.month),
    updatedAt: monthlyReviews.updatedAt,
    timestamptz: false,
    updateNeedsRow: false,
  },
  timeline: {
    table: timelineStages,
    keyColumn: timelineStages.id,
    keyValue: (key) => String(key.stageId),
    updatedAt: timelineStages.updatedAt,
    timestamptz: false,
    updateNeedsRow: true,
  },
};

/** Thrown out of the approval transaction when `apply` throws, so the caller runs the M1 path. */
class ExecutorError extends Error {
  constructor(readonly original: unknown) {
    super('proposal executor threw');
    this.name = 'ExecutorError';
  }
}

/** The innermost error message (drizzle's wrapper message embeds query params), truncated. */
export function failureMessage(error: unknown): string {
  let current: unknown = error;
  let message = 'unknown error';
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error && current.message) message = current.message;
    else if (typeof current === 'string') message = current;
    current = current && typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
  }
  return message.slice(0, MAX_FAILURE_MESSAGE_LENGTH);
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

async function lockProposal(tx: AgentTransaction, id: string): Promise<AdminProposalRow | null> {
  const rows = await tx.select(ADMIN_PROPOSAL_SELECTION).from(agentProposals).where(eq(agentProposals.id, id)).for('no key update');
  return (rows[0] as AdminProposalRow | undefined) ?? null;
}

async function audit(
  tx: AgentTransaction,
  action: 'approve' | 'reject',
  actor: AdminActor,
  row: AdminProposalRow | null,
  statusCode: number,
  details: AuditDetails
): Promise<void> {
  await recordAudit(tx, {
    actor: 'user',
    action,
    tokenId: row?.tokenId ?? null,
    userEmail: actor.email,
    proposalId: row?.id ?? null,
    method: 'POST',
    path: actor.path ?? null,
    statusCode,
    details: row ? { domain: row.domain, operation: row.operation, ...details } : details,
  });
}

function notFound(): DecisionOutcome {
  return { ok: false, httpStatus: 404, error: 'not_found', message: 'No proposal with this id.' };
}

/** Per-status table (B3) for a proposal that is no longer pending. */
function decidedOutcome(row: AdminProposalRow, action: 'approve' | 'reject'): DecisionOutcome {
  const proposal = toAdminProposalView(row);
  if (action === 'approve' && row.status === 'executed') {
    return { ok: true, httpStatus: 200, status: 'executed', after: (row.result ?? null) as JsonValue, idempotent: true, proposal };
  }
  return {
    ok: false,
    httpStatus: 409,
    error: 'proposal_not_pending',
    message: `The proposal is ${row.status}.`,
    status: row.status,
    proposal,
  };
}

async function auditedDecided(
  tx: AgentTransaction,
  action: 'approve' | 'reject',
  actor: AdminActor,
  row: AdminProposalRow
): Promise<DecisionOutcome> {
  const outcome = decidedOutcome(row, action);
  await audit(tx, action, actor, row, outcome.httpStatus, outcome.ok ? { idempotent: true } : { error: outcome.error, status: row.status });
  return outcome;
}

async function setStatus(
  tx: AgentTransaction,
  id: string,
  status: ProposalStatus,
  actor: AdminActor,
  result: JsonValue | null,
  executed = false
): Promise<AdminProposalRow> {
  const set: Partial<typeof agentProposals.$inferInsert> = {
    status,
    decidedAt: sql`now()` as unknown as Date,
    decidedBy: actor.email,
    result,
  };
  if (executed) set.executedAt = sql`now()` as unknown as Date;
  const rows = await tx
    .update(agentProposals)
    .set(set)
    .where(and(eq(agentProposals.id, id), eq(agentProposals.status, 'pending')))
    .returning(ADMIN_PROPOSAL_SELECTION);
  const updated = rows[0] as AdminProposalRow | undefined;
  // We hold the FOR NO KEY UPDATE lock and saw `pending`, so this cannot match zero rows.
  if (!updated) throw new Error(`setting proposal status ${status} updated no row under the lock`);
  return updated;
}

/** Terminal: the operation needs an existing row and it is gone (M6). */
async function failTargetMissing(tx: AgentTransaction, row: AdminProposalRow, actor: AdminActor): Promise<DecisionOutcome> {
  const failed = await setStatus(tx, row.id, 'failed', actor, { error: 'target_missing' });
  await audit(tx, 'approve', actor, row, 409, { error: 'target_missing' });
  return {
    ok: false,
    httpStatus: 409,
    error: 'target_missing',
    message: 'The target row no longer exists; the proposal failed. Ask the agent to propose again.',
    status: 'failed',
    proposal: toAdminProposalView(failed),
  };
}

/** Stale (B2): refresh `before`/`expected_updated_at`, commit, and let the owner decide again. */
async function refreshStale(
  tx: AgentTransaction,
  row: AdminProposalRow,
  module: DomainModule,
  key: TargetKey,
  actor: AdminActor
): Promise<DecisionOutcome> {
  const snapshot = await module.readSnapshot(tx, key);
  if (!snapshot) return failTargetMissing(tx, row, actor);
  if (row.operation === 'delete' && snapshot.before === null) return failTargetMissing(tx, row, actor);
  const touched = Object.keys(asObject(row.changes) ?? {});
  const before =
    snapshot.before === null ? null : row.operation === 'delete' ? snapshot.before : pickTouched(snapshot.before, touched);
  const rows = await tx
    .update(agentProposals)
    .set({ before, expectedUpdatedAt: snapshot.updatedAt, refreshedAt: sql`now()` as unknown as Date })
    .where(and(eq(agentProposals.id, row.id), eq(agentProposals.status, 'pending')))
    .returning(ADMIN_PROPOSAL_SELECTION);
  const refreshed = rows[0] as AdminProposalRow | undefined;
  if (!refreshed) throw new Error('refreshing a stale proposal updated no row under the lock');
  await audit(tx, 'approve', actor, row, 409, { error: 'stale' });
  return {
    ok: false,
    httpStatus: 409,
    error: 'stale',
    message: 'The target changed since the proposal was made. Review the refreshed values and approve again.',
    status: 'pending',
    proposal: toAdminProposalView(refreshed),
  };
}

/**
 * Locks the target row FOR UPDATE when it exists (M6) and compares its `updated_at` with the
 * proposal's `expected_updated_at` in SQL. An absent row is "unchanged" only if nothing was expected.
 */
async function lockTarget(
  tx: AgentTransaction,
  spec: TargetRowSpec,
  key: TargetKey,
  expected: string | null
): Promise<{ exists: boolean; unchanged: boolean }> {
  const unchanged: SQL<boolean> = spec.timestamptz
    ? sql<boolean>`(${spec.updatedAt} IS NOT DISTINCT FROM ${expected}::timestamptz)`
    : sql<boolean>`(${spec.updatedAt} IS NOT DISTINCT FROM ${expected}::text)`;
  const rows = await tx
    .select({ updatedAt: sql<string | null>`${spec.updatedAt}::text`, unchanged })
    .from(spec.table)
    .where(eq(spec.keyColumn, spec.keyValue(key)))
    .limit(1)
    .for('update');
  const row = rows[0];
  if (!row) return { exists: false, unchanged: expected === null };
  return { exists: true, unchanged: row.unchanged === true };
}

async function approveInTransaction(
  tx: AgentTransaction,
  id: string,
  input: ApproveInput,
  actor: AdminActor
): Promise<DecisionOutcome> {
  const row = await lockProposal(tx, id);
  if (!row) {
    await audit(tx, 'approve', actor, null, 404, { error: 'not_found' });
    return notFound();
  }
  if (row.status !== 'pending') return auditedDecided(tx, 'approve', actor, row);

  // M7: plain read, no token lock (revoke locks token -> proposals; we already hold the proposal).
  const tokens = await tx
    .select({ revokedAt: agentTokens.revokedAt })
    .from(agentTokens)
    .where(eq(agentTokens.id, row.tokenId))
    .limit(1);
  if (!tokens[0] || tokens[0].revokedAt !== null) {
    const cancelled = await setStatus(tx, row.id, 'cancelled', actor, { error: 'token_revoked' });
    await audit(tx, 'approve', actor, row, 409, { error: 'token_revoked' });
    return {
      ok: false,
      httpStatus: 409,
      error: 'token_revoked',
      message: 'The agent token that made this proposal was revoked; the proposal is cancelled.',
      status: 'cancelled',
      proposal: toAdminProposalView(cancelled),
    };
  }

  if (row.isExpired) {
    const expired = (await markExpiredIfNeeded(tx, row)) as AdminProposalRow;
    await audit(tx, 'approve', actor, row, 410, { error: 'expired' });
    return {
      ok: false,
      httpStatus: 410,
      error: 'expired',
      message: 'The proposal expired before it was approved.',
      status: 'expired',
      proposal: toAdminProposalView({ ...row, ...expired }),
    };
  }

  const warnings = Array.isArray(row.warnings) ? row.warnings : [];
  if (warnings.length > 0 && input.acknowledgeWarnings !== true) {
    await audit(tx, 'approve', actor, row, 422, { error: 'warnings_not_acknowledged' });
    return {
      ok: false,
      httpStatus: 422,
      error: 'warnings_not_acknowledged',
      message: 'This proposal has warnings; acknowledge them to approve.',
      status: 'pending',
      proposal: toAdminProposalView(row),
    };
  }

  if (input.expectedUpdatedAt !== row.expectedUpdatedAt) {
    await audit(tx, 'approve', actor, row, 409, { error: 'stale_client' });
    return {
      ok: false,
      httpStatus: 409,
      error: 'stale_client',
      message: 'The proposal changed since this page loaded. Reload and review it again.',
      status: 'pending',
      proposal: toAdminProposalView(row),
    };
  }

  const module = getDomain(row.domain);
  const key = asObject(row.targetKey) as TargetKey | null;
  if (!module || !key) throw new Error('stored proposal has an unknown domain or a malformed target');
  const spec = TARGET_ROWS[module.domain];

  const target = await lockTarget(tx, spec, key, row.expectedUpdatedAt);
  const needsRow = row.operation === 'delete' || spec.updateNeedsRow;
  if (!target.exists && needsRow) return failTargetMissing(tx, row, actor);
  if (!target.unchanged) return refreshStale(tx, row, module, key, actor);

  let applied: Awaited<ReturnType<DomainModule['apply']>>;
  try {
    applied = await module.apply(tx, key, row.operation === 'delete' ? 'delete' : ((asObject(row.changes) ?? {}) as JsonObject));
  } catch (error) {
    throw new ExecutorError(error);
  }
  if (!applied.applied) {
    if (applied.reason === 'insert_conflict') return refreshStale(tx, row, module, key, actor);
    return failTargetMissing(tx, row, actor);
  }

  const executed = await setStatus(tx, row.id, 'executed', actor, applied.after, true);
  await audit(tx, 'approve', actor, row, 200, { fields: Object.keys(asObject(row.changes) ?? {}) });
  return { ok: true, httpStatus: 200, status: 'executed', after: applied.after, idempotent: false, proposal: toAdminProposalView(executed) };
}

/**
 * M1: the executor threw and its transaction rolled back. Mark `failed` only if still pending; if
 * another approve won meanwhile, report the stored status (never overwrite `executed`).
 */
async function failAfterThrow(tx: AgentTransaction, id: string, error: unknown, actor: AdminActor): Promise<DecisionOutcome> {
  const rows = await tx
    .update(agentProposals)
    .set({
      status: 'failed',
      result: { error: failureMessage(error) },
      decidedAt: sql`now()` as unknown as Date,
      decidedBy: actor.email,
    })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.status, 'pending')))
    .returning(ADMIN_PROPOSAL_SELECTION);
  const failed = rows[0] as AdminProposalRow | undefined;
  if (failed) {
    await audit(tx, 'approve', actor, failed, 500, { error: 'execution_failed' });
    return {
      ok: false,
      httpStatus: 500,
      error: 'execution_failed',
      message: 'Applying the change failed; nothing was written. Ask the agent to propose again.',
      status: 'failed',
      proposal: toAdminProposalView(failed),
    };
  }
  const current = await tx.select(ADMIN_PROPOSAL_SELECTION).from(agentProposals).where(eq(agentProposals.id, id)).limit(1);
  const row = current[0] as AdminProposalRow | undefined;
  if (!row) return notFound();
  return auditedDecided(tx, 'approve', actor, row);
}

/** Approve + execute (flow step 4). Throws only for unexpected database errors. */
export async function approveProposal(id: string, input: ApproveInput, actor: AdminActor): Promise<DecisionOutcome> {
  try {
    return await db.transaction((tx) => approveInTransaction(tx, id, input, actor));
  } catch (error) {
    if (!(error instanceof ExecutorError)) throw error;
    console.warn(`[agent-approve] executor failed for a proposal: ${describeError(error.original)}`);
    return db.transaction((tx) => failAfterThrow(tx, id, error.original, actor));
  }
}

/** Reject (flow step 4): pending -> `rejected` + audit; otherwise the per-status table (B3). */
export async function rejectProposal(id: string, input: RejectInput, actor: AdminActor): Promise<DecisionOutcome> {
  return db.transaction(async (tx): Promise<DecisionOutcome> => {
    const locked = await lockProposal(tx, id);
    if (!locked) {
      await audit(tx, 'reject', actor, null, 404, { error: 'not_found' });
      return notFound();
    }
    const row = { ...locked, ...(await markExpiredIfNeeded(tx, locked)) } as AdminProposalRow;
    if (row.status !== 'pending') return auditedDecided(tx, 'reject', actor, row);
    const reason = input.reason?.trim();
    const rejected = await setStatus(tx, row.id, 'rejected', actor, reason ? { reason } : null);
    await audit(tx, 'reject', actor, row, 200, { hasReason: Boolean(reason) });
    return { ok: true, httpStatus: 200, status: 'rejected', idempotent: false, proposal: toAdminProposalView(rejected) };
  });
}

/** Admin list across all tokens with the token name; expired pending rows are marked lazily first (S2). */
export async function listAdminProposals(
  executor: AgentExecutor,
  options: { status?: ProposalStatus; limit?: number } = {}
): Promise<AdminProposalView[]> {
  await executor
    .update(agentProposals)
    .set({ status: 'expired' })
    .where(and(eq(agentProposals.status, 'pending'), sql`${agentProposals.expiresAt} <= now()`));
  const query = executor
    .select({ ...ADMIN_PROPOSAL_SELECTION, tokenName: agentTokens.name, tokenPrefix: agentTokens.tokenPrefix })
    .from(agentProposals)
    .innerJoin(agentTokens, eq(agentProposals.tokenId, agentTokens.id));
  const rows = await (options.status ? query.where(eq(agentProposals.status, options.status)) : query)
    .orderBy(desc(agentProposals.createdAt))
    .limit(options.limit ?? ADMIN_LIST_LIMIT);
  return (rows as Array<AdminProposalRow & { tokenName: string; tokenPrefix: string }>).map(toAdminProposalView);
}

/** Count for the badge; `pending` counts only unexpired rows (no write on this path). */
export async function countAdminProposals(executor: AgentExecutor, status: ProposalStatus = 'pending'): Promise<number> {
  const filters = [eq(agentProposals.status, status)];
  if (status === 'pending') filters.push(sql`${agentProposals.expiresAt} > now()`);
  const rows = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(agentProposals)
    .where(and(...filters));
  return Number(rows[0]?.n ?? 0);
}
