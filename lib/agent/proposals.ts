/**
 * Agent proposals (plan Step 6): creation, listing, reading and cancelling. Nothing here executes a
 * change; `apply` runs only from the owner's approval (Step 7).
 *
 * Transaction discipline (M5, M7): every query inside a `db.transaction` callback uses `tx`; lock
 * order is `agent_tokens` (FOR SHARE, creation only) -> `agent_proposals` (FOR NO KEY UPDATE).
 * `agent_tokens` is never locked FOR UPDATE.
 */
import { createHash, randomUUID } from 'crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentProposals, agentTokens } from '@/lib/db/schema';
import type { AgentExecutor } from './audit';
import { getAgentConfig, type AgentConfig } from './config';
import { getDomain } from './domains';
import {
  PROPOSAL_OPERATIONS,
  type JsonObject,
  type JsonValue,
  type ProposalOperation,
  type RatingsSource,
  type TargetKey,
} from './domains/types';
import { isPlainObject, unknownKey } from './domains/validate';
import { agentError, agentJson } from './http';
import { hasScope } from './scopes';

export const PROPOSAL_STATUSES = ['pending', 'executed', 'failed', 'rejected', 'cancelled', 'expired'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const MAX_REASON_LENGTH = 2_000;
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export const MAX_PROPOSAL_BODY_BYTES = 64 * 1024;
export const DEFAULT_LIST_LIMIT = 50;

const BODY_KEYS = ['domain', 'operation', 'target', 'changes', 'reason', 'idempotencyKey', 'ratingsSource'] as const;

/** Columns read for every proposal response; `isExpired` is evaluated on the database clock. */
export const PROPOSAL_SELECTION = {
  id: agentProposals.id,
  tokenId: agentProposals.tokenId,
  domain: agentProposals.domain,
  operation: agentProposals.operation,
  targetTable: agentProposals.targetTable,
  targetKey: agentProposals.targetKey,
  changes: agentProposals.changes,
  before: agentProposals.before,
  expectedUpdatedAt: agentProposals.expectedUpdatedAt,
  ratingsSource: agentProposals.ratingsSource,
  warnings: agentProposals.warnings,
  reason: agentProposals.reason,
  bodyHash: agentProposals.bodyHash,
  status: agentProposals.status,
  createdAt: agentProposals.createdAt,
  expiresAt: agentProposals.expiresAt,
  decidedAt: agentProposals.decidedAt,
  executedAt: agentProposals.executedAt,
  result: agentProposals.result,
  isExpired: sql<boolean>`(${agentProposals.expiresAt} <= now())`,
};

export type ProposalRow = {
  id: string;
  tokenId: string;
  domain: string;
  operation: string;
  targetTable: string;
  targetKey: unknown;
  changes: unknown;
  before: unknown;
  expectedUpdatedAt: string | null;
  ratingsSource: string | null;
  warnings: unknown;
  reason: string;
  bodyHash: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  executedAt: Date | null;
  result: unknown;
  isExpired: boolean;
};

/** What the agent sees. Never the token id or body hash. `before: null` = the row did not exist (M3). */
export interface ProposalView {
  id: string;
  domain: string;
  operation: string;
  target: unknown;
  changes: unknown;
  before: unknown;
  expectedUpdatedAt: string | null;
  warnings: string[];
  ratingsSource: string | null;
  reason: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  result: unknown;
}

export interface ProposalCaller {
  tokenId: string;
  scopes: readonly string[];
}

export type ProposalFailure = { ok: false; status: number; error: string; message: string; proposalStatus?: string };
export type ProposalOutcome = { ok: true; status: 200 | 202; proposal: ProposalView; replayed: boolean } | ProposalFailure;

/** Audit refinement for the route: `propose.<domain>.<operation>` once both are known. */
export interface CreateProposalResult {
  outcome: ProposalOutcome;
  domain?: string;
  operation?: string;
  fields?: string[];
  warnings?: number;
}

function failure(status: number, error: string, message: string, proposalStatus?: string): ProposalFailure {
  return proposalStatus ? { ok: false, status, error, message, proposalStatus } : { ok: false, status, error, message };
}

function invalid(message: string): ProposalFailure {
  return failure(422, 'invalid_proposal', message);
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function toProposalView(row: ProposalRow): ProposalView {
  return {
    id: row.id,
    domain: row.domain,
    operation: row.operation,
    target: row.targetKey,
    changes: row.changes,
    before: row.before ?? null,
    expectedUpdatedAt: row.expectedUpdatedAt,
    warnings: Array.isArray(row.warnings) ? row.warnings.filter((w): w is string => typeof w === 'string') : [],
    ratingsSource: row.ratingsSource,
    reason: row.reason,
    status: row.status,
    createdAt: iso(row.createdAt) as string,
    expiresAt: iso(row.expiresAt) as string,
    decidedAt: iso(row.decidedAt),
    executedAt: iso(row.executedAt),
    result: row.result ?? null,
  };
}

/** JSON with object keys sorted recursively, so the hash ignores key order (S10). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** sha256 of the canonical body without `idempotencyKey` (the key itself is the lookup). */
export function proposalBodyHash(body: Record<string, unknown>): string {
  const { idempotencyKey: _key, ...rest } = body;
  void _key;
  return createHash('sha256').update(canonicalJson(rest)).digest('hex');
}

/** `before` narrowed to the touched keys; an absent key is `null` (S9). */
export function pickTouched(before: JsonObject, keys: readonly string[]): JsonObject {
  const out: JsonObject = {};
  for (const key of keys) out[key] = (key in before ? before[key] : null) as JsonValue;
  return out;
}

async function selectByIdempotencyKey(executor: AgentExecutor, tokenId: string, key: string): Promise<ProposalRow | null> {
  const rows = await executor
    .select(PROPOSAL_SELECTION)
    .from(agentProposals)
    .where(and(eq(agentProposals.tokenId, tokenId), eq(agentProposals.idempotencyKey, key)))
    .limit(1);
  return (rows[0] as ProposalRow | undefined) ?? null;
}

/**
 * Lazy expiry (S2, no cron): a pending proposal past `expires_at` becomes `expired`. Returns the
 * current row. Conditional on `status = 'pending'` so it never overwrites a decision.
 */
export async function markExpiredIfNeeded(executor: AgentExecutor, row: ProposalRow): Promise<ProposalRow> {
  if (row.status !== 'pending' || !row.isExpired) return row;
  const updated = await executor
    .update(agentProposals)
    .set({ status: 'expired' })
    .where(
      and(eq(agentProposals.id, row.id), eq(agentProposals.status, 'pending'), sql`${agentProposals.expiresAt} <= now()`)
    )
    .returning(PROPOSAL_SELECTION);
  return (updated[0] as ProposalRow | undefined) ?? { ...row, status: 'expired' };
}

async function replayOutcome(executor: AgentExecutor, row: ProposalRow, bodyHash: string): Promise<ProposalOutcome> {
  if (row.bodyHash !== bodyHash) {
    return failure(422, 'idempotency_key_reused', 'This idempotencyKey was already used with a different request body.');
  }
  const current = await markExpiredIfNeeded(executor, row);
  return { ok: true, status: 200, proposal: toProposalView(current), replayed: true };
}

interface ParsedEnvelope {
  body: Record<string, unknown>;
  domain: string;
  operation: ProposalOperation;
}

/**
 * Validates and records a proposal. Order: body shape -> domain -> per-domain `:propose` scope (S4)
 * -> operation/target/changes/reason/key -> one transaction: token still live (FOR SHARE, M7) ->
 * idempotency (before the cap, S10) -> unexpired pending cap -> snapshot -> insert.
 */
export async function createProposal(
  caller: ProposalCaller,
  rawBody: unknown,
  config: AgentConfig = getAgentConfig()
): Promise<CreateProposalResult> {
  if (!isPlainObject(rawBody)) return { outcome: invalid('The request body must be a JSON object.') };
  const extra = unknownKey(rawBody, BODY_KEYS);
  if (extra !== null) return { outcome: invalid(`Unknown body field ${JSON.stringify(extra.slice(0, 40))}.`) };

  const module = getDomain(rawBody.domain);
  if (!module) {
    return { outcome: invalid('Unknown domain. Proposable domains: schedule, diary, feedback, reviews, timeline.') };
  }
  const requiredScope = `${module.domain}:propose`;
  if (!hasScope(caller.scopes, requiredScope)) {
    return {
      domain: module.domain,
      outcome: failure(403, 'insufficient_scope', `This token lacks the ${requiredScope} scope.`),
    };
  }

  const operation = rawBody.operation;
  if (typeof operation !== 'string' || !(PROPOSAL_OPERATIONS as readonly string[]).includes(operation)) {
    return { domain: module.domain, outcome: invalid('operation must be "update" or "delete".') };
  }
  if (!module.operations.includes(operation as ProposalOperation)) {
    return {
      domain: module.domain,
      outcome: invalid(`The ${module.domain} domain supports: ${module.operations.join(', ')}.`),
    };
  }
  const envelope: ParsedEnvelope = { body: rawBody, domain: module.domain, operation: operation as ProposalOperation };
  const meta = { domain: envelope.domain, operation: envelope.operation };

  const ratingsSourceRaw = rawBody.ratingsSource;
  if (ratingsSourceRaw !== undefined && ratingsSourceRaw !== 'user-dictated') {
    return { ...meta, outcome: invalid('ratingsSource, when present, must be "user-dictated".') };
  }
  const ratingsSource: RatingsSource | null = ratingsSourceRaw === 'user-dictated' ? 'user-dictated' : null;

  const target = module.validateTarget(rawBody.target);
  if (!target.ok) return { ...meta, outcome: invalid(target.message) };
  const validated = module.validateChanges(envelope.operation, rawBody.changes, { ratingsSource });
  if (!validated.ok) return { ...meta, outcome: invalid(validated.message) };

  const reason = rawBody.reason;
  if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > MAX_REASON_LENGTH) {
    return { ...meta, outcome: invalid(`reason must be a non-empty string of at most ${MAX_REASON_LENGTH} characters.`) };
  }
  const idempotencyKey = rawBody.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return { ...meta, outcome: invalid('idempotencyKey must be 8-128 characters of [A-Za-z0-9._:-].') };
  }

  const { changes, warnings } = validated.value;
  const touched = Object.keys(changes);
  const bodyHash = proposalBodyHash(rawBody);
  const targetKey: TargetKey = target.value;
  const details = { ...meta, fields: touched, warnings: warnings.length };

  const outcome = await db.transaction(async (tx): Promise<ProposalOutcome> => {
    // M7: the token must still be live inside this transaction; FOR SHARE blocks a concurrent revoke
    // (UPDATE agent_tokens) until we commit, after which the revoke cancels this proposal too.
    const live = await tx
      .select({ id: agentTokens.id })
      .from(agentTokens)
      .where(and(eq(agentTokens.id, caller.tokenId), isNull(agentTokens.revokedAt)))
      .for('share');
    if (!live[0]) return failure(401, 'invalid_token', 'Missing, malformed, unknown, revoked or expired agent token.');

    const existing = await selectByIdempotencyKey(tx, caller.tokenId, idempotencyKey);
    if (existing) return replayOutcome(tx, existing, bodyHash);

    const pending = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(agentProposals)
      .where(
        and(
          eq(agentProposals.tokenId, caller.tokenId),
          eq(agentProposals.status, 'pending'),
          sql`${agentProposals.expiresAt} > now()`
        )
      );
    if (Number(pending[0]?.n ?? 0) >= config.maxPending) {
      return failure(429, 'too_many_pending', `This token already has ${config.maxPending} pending proposals.`);
    }

    const snapshot = await module.readSnapshot(tx, targetKey);
    if (!snapshot) return failure(404, 'not_found', `The ${module.domain} target does not exist.`);
    if (envelope.operation === 'delete' && snapshot.before === null) {
      return failure(404, 'not_found', `There is no ${module.domain} entry to delete.`);
    }
    const before =
      snapshot.before === null ? null : envelope.operation === 'delete' ? snapshot.before : pickTouched(snapshot.before, touched);

    const id = `prp_${randomUUID()}`;
    await tx
      .insert(agentProposals)
      .values({
        id,
        tokenId: caller.tokenId,
        domain: module.domain,
        operation: envelope.operation,
        targetTable: module.table,
        targetKey,
        changes,
        before,
        expectedUpdatedAt: snapshot.updatedAt,
        ratingsSource,
        warnings,
        reason,
        idempotencyKey,
        bodyHash,
        status: 'pending',
        expiresAt: sql`now() + make_interval(hours => ${config.proposalTtlHours}::int)`,
      })
      .onConflictDoNothing({ target: [agentProposals.tokenId, agentProposals.idempotencyKey] });

    const stored = await selectByIdempotencyKey(tx, caller.tokenId, idempotencyKey);
    if (!stored) throw new Error('proposal insert returned no row');
    // A concurrent request with the same key won the insert: treat ours as its replay.
    if (stored.id !== id) return replayOutcome(tx, stored, bodyHash);
    return { ok: true, status: 202, proposal: toProposalView(stored), replayed: false };
  });

  return { ...details, outcome };
}

/** The caller's proposals, newest first; expired pending rows are marked lazily first (S2). */
export async function listProposals(
  executor: AgentExecutor,
  tokenId: string,
  options: { status?: ProposalStatus; limit?: number } = {}
): Promise<ProposalView[]> {
  await executor
    .update(agentProposals)
    .set({ status: 'expired' })
    .where(
      and(eq(agentProposals.tokenId, tokenId), eq(agentProposals.status, 'pending'), sql`${agentProposals.expiresAt} <= now()`)
    );
  const filters = [eq(agentProposals.tokenId, tokenId)];
  if (options.status) filters.push(eq(agentProposals.status, options.status));
  const rows = await executor
    .select(PROPOSAL_SELECTION)
    .from(agentProposals)
    .where(and(...filters))
    .orderBy(desc(agentProposals.createdAt))
    .limit(options.limit ?? DEFAULT_LIST_LIMIT);
  return (rows as ProposalRow[]).map(toProposalView);
}

/** One of the caller's own proposals (another token's id is indistinguishable from unknown). */
export async function getProposal(executor: AgentExecutor, tokenId: string, id: string): Promise<ProposalView | null> {
  const rows = await executor
    .select(PROPOSAL_SELECTION)
    .from(agentProposals)
    .where(and(eq(agentProposals.id, id), eq(agentProposals.tokenId, tokenId)))
    .limit(1);
  const row = rows[0] as ProposalRow | undefined;
  if (!row) return null;
  return toProposalView(await markExpiredIfNeeded(executor, row));
}

/** Cancels the caller's own pending proposal under a `FOR NO KEY UPDATE` lock (M5). */
export async function cancelProposal(tokenId: string, id: string): Promise<ProposalOutcome> {
  return db.transaction(async (tx): Promise<ProposalOutcome> => {
    const rows = await tx
      .select(PROPOSAL_SELECTION)
      .from(agentProposals)
      .where(and(eq(agentProposals.id, id), eq(agentProposals.tokenId, tokenId)))
      .for('no key update');
    const row = rows[0] as ProposalRow | undefined;
    if (!row) return failure(404, 'not_found', 'No proposal with this id for this token.');
    const current = await markExpiredIfNeeded(tx, row);
    if (current.status !== 'pending') {
      return failure(409, 'proposal_not_pending', `The proposal is ${current.status}.`, current.status);
    }
    const updated = await tx
      .update(agentProposals)
      .set({ status: 'cancelled', decidedAt: sql`now()`, decidedBy: 'agent' })
      .where(and(eq(agentProposals.id, id), eq(agentProposals.status, 'pending')))
      .returning(PROPOSAL_SELECTION);
    const cancelled = updated[0] as ProposalRow | undefined;
    if (!cancelled) throw new Error('cancel updated no row under the proposal lock');
    return { ok: true, status: 200, proposal: toProposalView(cancelled), replayed: false };
  });
}

export function isProposalStatus(value: unknown): value is ProposalStatus {
  return typeof value === 'string' && (PROPOSAL_STATUSES as readonly string[]).includes(value);
}

/** `{ ok: true, data }` with 200/202, or the error envelope (plus `status` for 409 not-pending). */
export function proposalOutcomeResponse(outcome: ProposalOutcome): Response {
  if (outcome.ok) return agentJson(outcome.proposal, { status: outcome.status });
  if (outcome.proposalStatus) {
    return Response.json(
      { ok: false, error: outcome.error, message: outcome.message, status: outcome.proposalStatus },
      { status: outcome.status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return agentError(outcome.status, outcome.error, outcome.message);
}
