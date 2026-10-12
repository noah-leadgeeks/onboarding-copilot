import { and, eq, sql, type SQL } from 'drizzle-orm';
import { agentAuditLog } from '@/lib/db/schema';
import type { AgentExecutor } from './audit';
import { getAgentConfig, type AgentConfig } from './config';

/**
 * Best-effort per-token rate limiting over `agent_audit_log` (S2). The current request's audit row
 * is reserved first, so the count includes it. Concurrent bursts can exceed the limit by a few.
 */
export type AgentActionKind = 'read' | 'proposal';

/** Read class: `read.<domain>`. Proposal class: `propose.<domain>.<operation>` and `cancel`. */
export function actionMatchesKind(action: string, kind: AgentActionKind): boolean {
  if (kind === 'read') return /^read\.[a-z0-9_.-]+$/.test(action);
  return action === 'cancel' || /^propose\.[a-z0-9_.-]+$/.test(action);
}

function classPredicate(kind: AgentActionKind): SQL {
  return kind === 'read'
    ? sql`${agentAuditLog.action} LIKE 'read.%'`
    : sql`(${agentAuditLog.action} LIKE 'propose.%' OR ${agentAuditLog.action} = 'cancel')`;
}

export function rateLimitFor(kind: AgentActionKind, config: AgentConfig = getAgentConfig()): number {
  return kind === 'read' ? config.readsPerMin : config.proposalsPerMin;
}

/** Agent actions of `kind` by this token in the last minute, excluding `rate_limited`/`auth.failed` rows. */
export async function countRecentAgentActions(
  executor: AgentExecutor,
  tokenId: string,
  kind: AgentActionKind
): Promise<number> {
  const rows = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(agentAuditLog)
    .where(
      and(
        eq(agentAuditLog.tokenId, tokenId),
        eq(agentAuditLog.actor, 'agent'),
        sql`${agentAuditLog.createdAt} > now() - interval '1 minute'`,
        sql`${agentAuditLog.action} NOT IN ('rate_limited', 'auth.failed')`,
        classPredicate(kind)
      )
    );
  return Number(rows[0]?.n ?? 0);
}

/** `auth.failed` rows written in the last minute, across all callers (S1 cap). */
export async function countRecentAuthFailures(executor: AgentExecutor): Promise<number> {
  const rows = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(agentAuditLog)
    .where(
      and(
        eq(agentAuditLog.action, 'auth.failed'),
        sql`${agentAuditLog.createdAt} > now() - interval '1 minute'`
      )
    );
  return Number(rows[0]?.n ?? 0);
}

export interface RateLimitDecision {
  limited: boolean;
  count: number;
  limit: number;
}

/** Call after reserving the request's audit row: the count already includes this request. */
export async function checkRateLimit(
  executor: AgentExecutor,
  tokenId: string,
  kind: AgentActionKind,
  config: AgentConfig = getAgentConfig()
): Promise<RateLimitDecision> {
  const limit = rateLimitFor(kind, config);
  const count = await countRecentAgentActions(executor, tokenId, kind);
  return { limited: count > limit, count, limit };
}
