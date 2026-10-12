/**
 * Shared contract for the proposable domains (plan Step 6). Each module owns the whitelist of
 * `changes` keys, target validation, the snapshot read (`updated_at::text`, M4) and the DB-only
 * executor (`apply`, run by Step 7 inside the approval transaction; never touches Sheets, D2).
 */
import type { AgentExecutor, AgentTransaction } from '../audit';

export const PROPOSAL_DOMAINS = ['schedule', 'diary', 'feedback', 'reviews', 'timeline'] as const;
export type ProposalDomain = (typeof PROPOSAL_DOMAINS)[number];

export const PROPOSAL_OPERATIONS = ['update', 'delete'] as const;
export type ProposalOperation = (typeof PROPOSAL_OPERATIONS)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Validated target key as stored in `agent_proposals.target_key`. */
export type TargetKey = Record<string, string | number>;

/** Whitelisted keys only (S9 partial merge); `{}` for delete. */
export type ProposalChanges = JsonObject;

export type RatingsSource = 'user-dictated';

export type Validated<T> = { ok: true; value: T } | { ok: false; message: string };

export interface ValidatedChanges {
  changes: ProposalChanges;
  /** e.g. `formula_like:notes` (S5). */
  warnings: string[];
}

export interface ChangeContext {
  ratingsSource: RatingsSource | null;
}

/**
 * `before` holds every whitelisted field of the row (callers narrow it to the touched keys);
 * `before: null` means the target exists but has no row yet (diary/feedback/reviews upserts), and
 * `updatedAt` is the row's `updated_at::text` (null when absent or NULL). The method returns null
 * when the target itself does not exist (404).
 */
export interface DomainSnapshot {
  before: JsonObject | null;
  updatedAt: string | null;
}

/**
 * Result of `apply`. `target_missing`: an UPDATE/DELETE touched no row. `insert_conflict`: an
 * upsert insert hit `ON CONFLICT DO NOTHING` (a row appeared concurrently; Step 7 treats it as stale).
 */
export type ApplyResult =
  | { applied: true; after: JsonObject | null }
  | { applied: false; reason: 'target_missing' | 'insert_conflict' };

export interface DomainModule {
  domain: ProposalDomain;
  /** Postgres table name stored in `agent_proposals.target_table`. */
  table: string;
  operations: readonly ProposalOperation[];
  /** Every key `validateChanges` can accept (used for `before` on delete and for docs). */
  fields: readonly string[];
  validateTarget(raw: unknown): Validated<TargetKey>;
  validateChanges(operation: ProposalOperation, raw: unknown, context: ChangeContext): Validated<ValidatedChanges>;
  readSnapshot(executor: AgentExecutor, key: TargetKey): Promise<DomainSnapshot | null>;
  /** Bumps `updated_at` (M2). Only for use inside the approval transaction (Step 7). */
  apply(tx: AgentTransaction, key: TargetKey, changes: ProposalChanges | 'delete'): Promise<ApplyResult>;
}
