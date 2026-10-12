/**
 * Owner-side token administration behind `/api/agent-admin/tokens*` and `/api/agent-admin/audit`:
 * issue (plaintext returned once, only the sha256 hash is stored), list (never the hash), revoke,
 * and recent audit rows. Inputs are validated here so the routes stay thin.
 *
 * Lock order token -> proposals (M7, S13): the `UPDATE agent_tokens` takes the token's
 * `FOR NO KEY UPDATE` row lock (never `SELECT ... FOR UPDATE` on the token, which deadlocks
 * against `createProposal`'s `FOR SHARE` plus FK key-share locks), then the token's pending
 * proposals are locked `FOR NO KEY UPDATE` and cancelled. All queries use `tx` (M5).
 */
import { randomUUID } from 'crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NovaDatabase } from '@/lib/db';
import { agentAuditLog, agentProposals, agentTokens } from '@/lib/db/schema';
import { recordAudit, type AgentExecutor } from './audit';
import { getAgentConfig } from './config';
import { isPlainObject, unknownKey } from './domains/validate';
import { parseScopes, type AgentScope } from './scopes';
import { generateAgentToken } from './tokens';

export const MAX_TOKEN_NAME_LENGTH = 80;
export const MAX_TOKEN_TTL_DAYS = 365;
export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 200;
export const TOKEN_LIST_LIMIT = 100;

/** Token as shown to the owner: never the hash, never the plaintext. */
export interface AgentTokenView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface IssueTokenInput {
  name: string;
  scopes: AgentScope[];
  /** Omitted: `AGENT_TOKEN_DEFAULT_TTL_DAYS` (default 90). */
  expiresInDays?: number;
}

export type ParsedIssueInput = { ok: true; value: IssueTokenInput } | { ok: false; message: string };

/** Selection for token lists: explicitly excludes `token_hash`. */
const TOKEN_VIEW_SELECTION = {
  id: agentTokens.id,
  name: agentTokens.name,
  prefix: agentTokens.tokenPrefix,
  scopes: agentTokens.scopes,
  createdAt: agentTokens.createdAt,
  expiresAt: agentTokens.expiresAt,
  lastUsedAt: agentTokens.lastUsedAt,
  revokedAt: agentTokens.revokedAt,
};

type TokenViewRow = {
  id: string;
  name: string;
  prefix: string;
  scopes: unknown;
  createdAt: Date | string;
  expiresAt: Date | string | null;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
};

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function toTokenView(row: TokenViewRow): AgentTokenView {
  const scopes = Array.isArray(row.scopes) ? row.scopes.filter((scope): scope is string => typeof scope === 'string') : [];
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes,
    createdAt: iso(row.createdAt) ?? '',
    expiresAt: iso(row.expiresAt),
    lastUsedAt: iso(row.lastUsedAt),
    revokedAt: iso(row.revokedAt),
  };
}

// Printable characters only (no control characters such as newlines or tabs).
const PRINTABLE_NAME = /^[^\u0000-\u001f\u007f]+$/;

/** Validates `{ name, scopes[], expiresInDays? }` (unknown keys rejected, scopes via `parseScopes`). */
export function parseIssueTokenBody(raw: unknown): ParsedIssueInput {
  if (!isPlainObject(raw)) return { ok: false, message: 'The request body must be a JSON object.' };
  const extra = unknownKey(raw, ['name', 'scopes', 'expiresInDays']);
  if (extra !== null) return { ok: false, message: `Unknown body field ${JSON.stringify(extra.slice(0, 40))}.` };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name.length === 0 || name.length > MAX_TOKEN_NAME_LENGTH || !PRINTABLE_NAME.test(name)) {
    return { ok: false, message: `name is required: 1-${MAX_TOKEN_NAME_LENGTH} printable characters.` };
  }
  const scopes = parseScopes(raw.scopes);
  if (!scopes) return { ok: false, message: 'scopes must be a non-empty array of known scopes.' };
  const days = raw.expiresInDays;
  if (days !== undefined && (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_TOKEN_TTL_DAYS)) {
    return { ok: false, message: `expiresInDays, when present, must be a whole number from 1 to ${MAX_TOKEN_TTL_DAYS}.` };
  }
  return { ok: true, value: days === undefined ? { name, scopes } : { name, scopes, expiresInDays: days } };
}

export async function listAgentTokens(executor: AgentExecutor): Promise<AgentTokenView[]> {
  const rows = await executor
    .select(TOKEN_VIEW_SELECTION)
    .from(agentTokens)
    .orderBy(desc(agentTokens.createdAt))
    .limit(TOKEN_LIST_LIMIT);
  return (rows as TokenViewRow[]).map(toTokenView);
}

/**
 * Issues a token: insert + `token.issue` audit in one transaction (all on `tx`, M5). Returns the
 * plaintext exactly once; it is never stored, logged or audited.
 */
export async function issueAgentToken(
  database: NovaDatabase,
  input: IssueTokenInput,
  email: string,
  options: { path?: string | null } = {}
): Promise<{ token: string; view: AgentTokenView }> {
  const days = input.expiresInDays ?? getAgentConfig().tokenDefaultTtlDays;
  const generated = generateAgentToken();
  const id = `tok_${randomUUID()}`;
  return database.transaction(async (tx) => {
    const inserted = await tx
      .insert(agentTokens)
      .values({
        id,
        name: input.name,
        tokenPrefix: generated.prefix,
        tokenHash: generated.hash,
        scopes: input.scopes,
        createdBy: email,
        expiresAt: sql`now() + make_interval(days => ${days})` as unknown as Date,
      })
      .returning(TOKEN_VIEW_SELECTION);
    const row = inserted[0] as TokenViewRow | undefined;
    if (!row) throw new Error('token insert returned no row');
    await recordAudit(tx, {
      actor: 'user',
      action: 'token.issue',
      tokenId: id,
      tokenPrefix: generated.prefix,
      userEmail: email,
      method: 'POST',
      path: options.path ?? null,
      statusCode: 201,
      details: { scopes: [...input.scopes], expiresInDays: days },
    });
    return { token: generated.token, view: toTokenView(row) };
  });
}

/** Audit row as shown to the owner (details hold field names and counts only, never values). */
export interface AuditView {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  tokenId: string | null;
  tokenPrefix: string | null;
  userEmail: string | null;
  proposalId: string | null;
  method: string | null;
  path: string | null;
  statusCode: number | null;
  durationMs: number | null;
  details: unknown;
}

/** Clamps `?limit=`: absent -> 50; must be a whole number 1..200 when present (null = invalid). */
export function parseAuditLimit(raw: string | undefined): number | null {
  if (raw === undefined) return AUDIT_DEFAULT_LIMIT;
  if (!/^[1-9]\d{0,5}$/.test(raw)) return null;
  return Math.min(Number(raw), AUDIT_MAX_LIMIT);
}

export async function listAuditRows(
  executor: AgentExecutor,
  options: { tokenId?: string; limit?: number } = {}
): Promise<AuditView[]> {
  const limit = Math.min(Math.max(options.limit ?? AUDIT_DEFAULT_LIMIT, 1), AUDIT_MAX_LIMIT);
  const query = executor
    .select({
      id: agentAuditLog.id,
      createdAt: agentAuditLog.createdAt,
      actor: agentAuditLog.actor,
      action: agentAuditLog.action,
      tokenId: agentAuditLog.tokenId,
      tokenPrefix: agentAuditLog.tokenPrefix,
      userEmail: agentAuditLog.userEmail,
      proposalId: agentAuditLog.proposalId,
      method: agentAuditLog.method,
      path: agentAuditLog.path,
      statusCode: agentAuditLog.statusCode,
      durationMs: agentAuditLog.durationMs,
      details: agentAuditLog.details,
    })
    .from(agentAuditLog);
  const rows = await (options.tokenId ? query.where(eq(agentAuditLog.tokenId, options.tokenId)) : query)
    .orderBy(desc(agentAuditLog.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, createdAt: iso(row.createdAt as Date | string) ?? '' }));
}

export type RevokeResult =
  | { status: 'revoked'; cancelledProposalIds: string[] }
  | { status: 'already_revoked' }
  | { status: 'not_found' };

export async function revokeAgentToken(
  database: NovaDatabase,
  id: string,
  email: string,
  options: { path?: string | null } = {}
): Promise<RevokeResult> {
  return database.transaction(async (tx): Promise<RevokeResult> => {
    const revoked = await tx
      .update(agentTokens)
      .set({ revokedAt: sql`now()` as unknown as Date })
      .where(and(eq(agentTokens.id, id), isNull(agentTokens.revokedAt)))
      .returning({ id: agentTokens.id, tokenPrefix: agentTokens.tokenPrefix });
    if (!revoked[0]) {
      const existing = await tx.select({ id: agentTokens.id }).from(agentTokens).where(eq(agentTokens.id, id)).limit(1);
      return existing[0] ? { status: 'already_revoked' } : { status: 'not_found' };
    }

    const pending = await tx
      .select({ id: agentProposals.id })
      .from(agentProposals)
      .where(and(eq(agentProposals.tokenId, id), eq(agentProposals.status, 'pending')))
      .for('no key update');
    let cancelledProposalIds: string[] = [];
    if (pending.length > 0) {
      const cancelled = await tx
        .update(agentProposals)
        .set({
          status: 'cancelled',
          decidedAt: sql`now()` as unknown as Date,
          decidedBy: email,
          result: { error: 'token_revoked' },
        })
        .where(
          and(
            inArray(
              agentProposals.id,
              pending.map((row) => row.id)
            ),
            eq(agentProposals.status, 'pending')
          )
        )
        .returning({ id: agentProposals.id });
      cancelledProposalIds = cancelled.map((row) => row.id);
    }

    await recordAudit(tx, {
      actor: 'user',
      action: 'token.revoke',
      tokenId: id,
      tokenPrefix: revoked[0].tokenPrefix,
      userEmail: email,
      method: 'POST',
      path: options.path ?? null,
      statusCode: 200,
      details: { cancelled: cancelledProposalIds.length },
    });
    return { status: 'revoked', cancelledProposalIds };
  });
}
