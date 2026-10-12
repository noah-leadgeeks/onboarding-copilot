import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { NovaDatabase } from '@/lib/db';
import { agentAuditLog } from '@/lib/db/schema';
import { describeError } from './errors';
import { sanitizeTokenPrefix } from './token-format';

export type AgentTransaction = Parameters<Parameters<NovaDatabase['transaction']>[0]>[0];
/** `db` outside a transaction, the callback's `tx` inside one (M5). Never mix them. */
export type AgentExecutor = NovaDatabase | AgentTransaction;

export type AuditActor = 'agent' | 'user' | 'system';
/** Field names, counts and flags only; never values, payload text or tokens. */
export type AuditDetails = Record<string, string | number | boolean | null | string[]>;

export interface AuditRowInput {
  actor: AuditActor;
  action: string;
  tokenId?: string | null;
  tokenPrefix?: string | null;
  userEmail?: string | null;
  proposalId?: string | null;
  method?: string | null;
  /** A pathname or full URL; only the pathname is stored. */
  path?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  details?: AuditDetails | null;
}

export interface AuditUpdate {
  action?: string;
  proposalId?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  details?: AuditDetails | null;
}

export type AuditResult = { ok: true; id: string } | { ok: false; error: unknown };

const MAX_PATH_LENGTH = 512;
const TOKEN_LIKE = /nova_agt_[A-Za-z0-9_-]*/g;

/** Pathname only: no query string or fragment, token-like substrings redacted, length capped. */
export function sanitizeAuditPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let pathname = raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      pathname = raw;
    }
  }
  pathname = pathname.split(/[?#]/, 1)[0];
  return pathname.replace(TOKEN_LIKE, '[redacted]').slice(0, MAX_PATH_LENGTH) || null;
}

function scrubDetails(details: AuditDetails | null | undefined): AuditDetails | null {
  if (!details) return null;
  const out: AuditDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string') out[key] = value.replace(TOKEN_LIKE, '[redacted]');
    else if (Array.isArray(value)) out[key] = value.map((item) => item.replace(TOKEN_LIKE, '[redacted]'));
    else out[key] = value;
  }
  return out;
}

function toInt(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function isTransaction(executor: AgentExecutor): executor is AgentTransaction {
  return executor instanceof PgTransaction;
}

/**
 * Runs `work` on the executor. Inside a transaction it runs in a savepoint (nested `tx.transaction`)
 * so a failed audit statement (FK/CHECK violation) rolls back only the savepoint and does not abort
 * the caller's transaction (SQLSTATE 25P02).
 */
async function runIsolated(executor: AgentExecutor, work: (exec: AgentExecutor) => Promise<unknown>): Promise<void> {
  if (isTransaction(executor)) {
    await executor.transaction(async (savepoint) => {
      await work(savepoint);
    });
    return;
  }
  await work(executor);
}

/**
 * Inserts one audit row on the given executor (`db` or a `tx`, M5). Never throws: failures are
 * logged (class and SQLSTATE only) and returned so callers can decide (e.g. map `42P01`).
 */
export async function recordAudit(executor: AgentExecutor, row: AuditRowInput): Promise<AuditResult> {
  const id = `aud_${randomUUID()}`;
  try {
    await runIsolated(executor, (exec) =>
      exec.insert(agentAuditLog).values({
        id,
        actor: row.actor,
        action: row.action,
        tokenId: row.tokenId ?? null,
        tokenPrefix: sanitizeTokenPrefix(row.tokenPrefix),
        userEmail: row.userEmail ?? null,
        proposalId: row.proposalId ?? null,
        method: row.method ? row.method.toUpperCase().slice(0, 16) : null,
        path: sanitizeAuditPath(row.path),
        statusCode: toInt(row.statusCode),
        durationMs: toInt(row.durationMs),
        details: scrubDetails(row.details),
      })
    );
    return { ok: true, id };
  } catch (error) {
    console.warn(`[agent-audit] insert failed for action ${row.action.slice(0, 64)}: ${describeError(error)}`);
    return { ok: false, error };
  }
}

/** Finalizes a reserved audit row. Never throws; same contract as `recordAudit`. */
export async function updateAudit(executor: AgentExecutor, id: string, patch: AuditUpdate): Promise<AuditResult> {
  const set: Partial<typeof agentAuditLog.$inferInsert> = {};
  if (patch.action !== undefined) set.action = patch.action;
  if (patch.proposalId !== undefined) set.proposalId = patch.proposalId;
  if (patch.statusCode !== undefined) set.statusCode = toInt(patch.statusCode);
  if (patch.durationMs !== undefined) set.durationMs = toInt(patch.durationMs);
  if (patch.details !== undefined) set.details = scrubDetails(patch.details);
  if (Object.keys(set).length === 0) return { ok: true, id };
  try {
    await runIsolated(executor, (exec) => exec.update(agentAuditLog).set(set).where(eq(agentAuditLog.id, id)));
    return { ok: true, id };
  } catch (error) {
    console.warn(`[agent-audit] update failed: ${describeError(error)}`);
    return { ok: false, error };
  }
}
