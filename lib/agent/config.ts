/**
 * Agent API limits, read from the environment on every call so tests and deploys can change them
 * without a rebuild. Invalid or non-positive values fall back to the defaults (plan D4).
 */
export const AGENT_CONFIG_DEFAULTS = {
  readsPerMin: 60,
  proposalsPerMin: 10,
  maxPending: 20,
  proposalTtlHours: 24,
  tokenDefaultTtlDays: 90,
} as const;

/** Maximum `auth.failed` audit rows written per minute across all callers (S1). */
export const AUTH_FAILED_AUDIT_CAP_PER_MIN = 20;

/** Seconds a rate-limited caller is told to wait (`Retry-After`). */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export interface AgentConfig {
  readsPerMin: number;
  proposalsPerMin: number;
  maxPending: number;
  proposalTtlHours: number;
  tokenDefaultTtlDays: number;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) return fallback;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function getAgentConfig(): AgentConfig {
  return {
    readsPerMin: readPositiveInt('AGENT_RATE_LIMIT_READS_PER_MIN', AGENT_CONFIG_DEFAULTS.readsPerMin),
    proposalsPerMin: readPositiveInt('AGENT_RATE_LIMIT_PROPOSALS_PER_MIN', AGENT_CONFIG_DEFAULTS.proposalsPerMin),
    maxPending: readPositiveInt('AGENT_MAX_PENDING_PROPOSALS', AGENT_CONFIG_DEFAULTS.maxPending),
    proposalTtlHours: readPositiveInt('AGENT_PROPOSAL_TTL_HOURS', AGENT_CONFIG_DEFAULTS.proposalTtlHours),
    tokenDefaultTtlDays: readPositiveInt('AGENT_TOKEN_DEFAULT_TTL_DAYS', AGENT_CONFIG_DEFAULTS.tokenDefaultTtlDays),
  };
}
