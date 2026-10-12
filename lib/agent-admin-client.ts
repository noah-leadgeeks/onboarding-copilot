/**
 * Browser-side helpers for Settings › AI agent access and the nav badge. Pure functions plus thin
 * fetch wrappers (fetch is injectable for tests). Never imports server modules (db, crypto).
 *
 * Every request is same-origin with credentials and `Content-Type: application/json` on mutations
 * (the admin routes reject anything else, `lib/agent/admin-auth.ts`). Token plaintext is never
 * written to storage: the caller keeps it in component state only.
 */
import { SCOPES } from './agent/scopes';

export const AGENT_PROPOSALS_CHANGED_EVENT = 'nova:agent-proposals-changed';

export const ADMIN_BASE = '/api/agent-admin';

/** Shown in place of the cards when the agent migration has not been applied (M11). */
export const NOT_SET_UP_MESSAGE = 'Agent access is not set up on this database';

export const FORMULA_ACK_LABEL = 'I understand this text looks like a formula';

/** ADR-0003 callout for proposals that carry ratings or scores. */
export const RATINGS_SOURCE_TEXT =
  'The agent says you dictated these ratings yourself. AI must never evaluate or score your performance (ADR-0003): approve only if these are exactly the scores you gave.';

export interface AgentTokenInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface AgentProposalInfo {
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
  refreshedAt?: string | null;
  tokenName?: string;
  tokenPrefix?: string;
}

/** Result of a GET against an admin route, as the UI needs it. */
export type AdminLoad<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'missing' } // agent tables not migrated yet (200 { ok:false, error:'agent_tables_missing' })
  | { kind: 'unavailable'; status: number; error: string; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Maps an admin GET response to `AdminLoad`; `agent_tables_missing` is a quiet state, not an error. */
export function interpretAdminLoad<T>(status: number, body: unknown, pick: (data: unknown) => T | null): AdminLoad<T> {
  if (isRecord(body) && body.ok === false && body.error === 'agent_tables_missing') return { kind: 'missing' };
  if (status >= 200 && status < 300 && isRecord(body) && body.ok === true) {
    const data = pick(body.data);
    if (data !== null) return { kind: 'ok', data };
  }
  const error = isRecord(body) && typeof body.error === 'string' ? body.error : 'unexpected_response';
  const message = isRecord(body) && typeof body.message === 'string' ? body.message : 'The server returned an unexpected response.';
  return { kind: 'unavailable', status, error, message };
}

/** Plain-language reason for an admin route that cannot be used (403/503 etc.). */
export function unavailableMessage(load: { status: number; error: string; message: string }): string {
  switch (load.error) {
    case 'not_owner':
      return 'This account is not allowed to manage agent access.';
    case 'admin_allowlist_unset':
      return 'Agent access is turned off: no owner email is configured (AGENT_ADMIN_EMAILS).';
    case 'auth_secret_required':
      return 'Agent access needs AUTH_SECRET to be configured on the server.';
    case 'agent_api_requires_database':
      return 'Agent access works only when the app uses its database.';
    case 'unauthenticated':
      return 'Sign in to manage agent access.';
    default:
      return load.message;
  }
}

export function pickTokens(data: unknown): { tokens: AgentTokenInfo[]; defaultExpiresInDays: number } | null {
  if (!isRecord(data) || !Array.isArray(data.tokens)) return null;
  const days = typeof data.defaultExpiresInDays === 'number' ? data.defaultExpiresInDays : 90;
  return { tokens: data.tokens as AgentTokenInfo[], defaultExpiresInDays: days };
}

export function pickProposals(data: unknown): AgentProposalInfo[] | null {
  if (!isRecord(data) || !Array.isArray(data.proposals)) return null;
  return data.proposals as AgentProposalInfo[];
}

/** Badge count from `?countOnly=1`; null (render nothing) for anything but a clean positive count. */
export function badgeCount(status: number, body: unknown): number | null {
  if (status !== 200 || !isRecord(body) || body.ok !== true || !isRecord(body.data)) return null;
  const count = body.data.count;
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : null;
}

const JSON_POST: RequestInit = {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
};

async function getAdmin<T>(fetchImpl: FetchLike, path: string, pick: (data: unknown) => T | null): Promise<AdminLoad<T>> {
  try {
    const response = await fetchImpl(`${ADMIN_BASE}${path}`, { credentials: 'same-origin', cache: 'no-store' });
    return interpretAdminLoad(response.status, await readJson(response), pick);
  } catch {
    return { kind: 'unavailable', status: 0, error: 'network_error', message: 'Couldn’t reach the server.' };
  }
}

export function loadTokens(fetchImpl: FetchLike = fetch) {
  return getAdmin(fetchImpl, '/tokens', pickTokens);
}

export function loadPendingProposals(fetchImpl: FetchLike = fetch) {
  return getAdmin(fetchImpl, '/proposals?status=pending', pickProposals);
}

export async function loadPendingCount(fetchImpl: FetchLike = fetch): Promise<number | null> {
  try {
    const response = await fetchImpl(`${ADMIN_BASE}/proposals?countOnly=1`, { credentials: 'same-origin', cache: 'no-store' });
    return badgeCount(response.status, await readJson(response));
  } catch {
    return null;
  }
}

export interface PostResult {
  status: number;
  ok: boolean;
  error: string | null;
  message: string;
  data: unknown;
  body: Record<string, unknown>;
}

async function postAdmin(fetchImpl: FetchLike, path: string, body: unknown): Promise<PostResult> {
  try {
    const response = await fetchImpl(`${ADMIN_BASE}${path}`, { ...JSON_POST, body: JSON.stringify(body) });
    const json = await readJson(response);
    const record = isRecord(json) ? json : {};
    return {
      status: response.status,
      ok: record.ok === true,
      error: typeof record.error === 'string' ? record.error : record.ok === true ? null : 'unexpected_response',
      message: typeof record.message === 'string' ? record.message : '',
      data: record.data,
      body: record,
    };
  } catch {
    return { status: 0, ok: false, error: 'network_error', message: 'Couldn’t reach the server.', data: null, body: {} };
  }
}

export interface IssueTokenRequest {
  name: string;
  scopes: string[];
  expiresInDays?: number;
}

export function issueToken(request: IssueTokenRequest, fetchImpl: FetchLike = fetch) {
  return postAdmin(fetchImpl, '/tokens', request);
}

export function revokeToken(id: string, fetchImpl: FetchLike = fetch) {
  return postAdmin(fetchImpl, `/tokens/${encodeURIComponent(id)}/revoke`, {});
}

/** Approve body: always the `expectedUpdatedAt` the card displayed (string or null). */
export function approveBody(proposal: Pick<AgentProposalInfo, 'expectedUpdatedAt' | 'warnings'>, acknowledged: boolean) {
  const body: { expectedUpdatedAt: string | null; acknowledgeWarnings?: boolean } = { expectedUpdatedAt: proposal.expectedUpdatedAt };
  if (proposal.warnings.length > 0) body.acknowledgeWarnings = acknowledged;
  return body;
}

export function approveProposalRequest(proposal: AgentProposalInfo, acknowledged: boolean, fetchImpl: FetchLike = fetch) {
  return postAdmin(fetchImpl, `/proposals/${encodeURIComponent(proposal.id)}/approve`, approveBody(proposal, acknowledged));
}

export function rejectProposalRequest(proposal: AgentProposalInfo, fetchImpl: FetchLike = fetch) {
  return postAdmin(fetchImpl, `/proposals/${encodeURIComponent(proposal.id)}/reject`, {});
}

/** What the requests card does after approve/reject. */
export type DecisionAction =
  | { kind: 'done'; message: string } // remove from the pending list
  | { kind: 'stale'; proposal: AgentProposalInfo; message: string } // re-render with refreshed before, ask again
  | { kind: 'reload'; message: string } // refetch the list (stale_client, no longer pending, ...)
  | { kind: 'error'; message: string }; // keep the card, show the message

function proposalFrom(body: Record<string, unknown>): AgentProposalInfo | null {
  const candidate = body.proposal;
  return isRecord(candidate) && typeof candidate.id === 'string' ? (candidate as unknown as AgentProposalInfo) : null;
}

export function decisionAction(kind: 'approve' | 'reject', result: PostResult): DecisionAction {
  if (result.ok) {
    if (kind === 'reject') return { kind: 'done', message: 'Request declined. Nothing was changed.' };
    const data = isRecord(result.data) ? result.data : {};
    return {
      kind: 'done',
      message: data.idempotent === true ? 'This request was already approved.' : 'Approved and saved. Push it to the spreadsheet with “Sync all” when you’re ready.',
    };
  }
  switch (result.error) {
    case 'stale': {
      const refreshed = proposalFrom(result.body);
      if (refreshed) {
        return { kind: 'stale', proposal: refreshed, message: 'This entry changed since the agent asked. Review the updated current values and approve again.' };
      }
      return { kind: 'reload', message: 'This entry changed since the agent asked. The list was refreshed.' };
    }
    case 'stale_client':
      return { kind: 'reload', message: 'This request changed since the page loaded. The list was refreshed; please review it again.' };
    case 'warnings_not_acknowledged':
      return { kind: 'error', message: 'Tick the formula checkbox before approving.' };
    case 'token_revoked':
      return { kind: 'reload', message: 'The token that made this request was revoked, so the request was cancelled.' };
    case 'expired':
      return { kind: 'reload', message: 'This request expired before it was approved.' };
    case 'target_missing':
      return { kind: 'reload', message: 'The entry this request changes no longer exists. The agent needs to ask again.' };
    case 'proposal_not_pending':
      return { kind: 'reload', message: 'This request was already decided.' };
    case 'not_found':
      return { kind: 'reload', message: 'This request no longer exists.' };
    default:
      return { kind: 'error', message: result.message || 'Couldn’t complete that. Try again.' };
  }
}

/** One row of the before/after table: full values, never a summary. */
export interface DiffRow {
  field: string;
  before: string;
  after: string;
  /** False when the row did not exist (before is SQL NULL). */
  hasBefore: boolean;
}

/** Full text of a value: strings verbatim, everything else as pretty JSON. */
export function displayValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

/** Field-by-field rows for the proposal: union of before/changes keys (delete: every before key). */
export function diffRows(proposal: Pick<AgentProposalInfo, 'operation' | 'before' | 'changes'>): DiffRow[] {
  const before = isRecord(proposal.before) ? proposal.before : null;
  const changes = isRecord(proposal.changes) ? proposal.changes : {};
  const isDelete = proposal.operation === 'delete';
  const fields = isDelete ? Object.keys(before ?? {}) : Array.from(new Set([...Object.keys(changes), ...Object.keys(before ?? {})]));
  return fields.map((field) => ({
    field,
    before: before ? displayValue(before[field]) : '',
    after: isDelete ? '' : field in changes ? displayValue(changes[field]) : displayValue(before?.[field]),
    hasBefore: before !== null,
  }));
}

/** `formula_like:<field>` -> readable sentence; unknown codes are shown as-is. */
export function describeWarning(code: string): string {
  const match = /^formula_like:(.+)$/.exec(code);
  if (match) return `“${match[1]}” starts with =, +, -, @, a tab or a line break, so the spreadsheet could treat it as a formula.`;
  return code;
}

/** True when the proposal touches any rating/score field (shows the ADR-0003 callout). */
export function touchesRatings(proposal: Pick<AgentProposalInfo, 'changes' | 'ratingsSource'>): boolean {
  if (proposal.ratingsSource) return true;
  const changes = isRecord(proposal.changes) ? proposal.changes : {};
  return Object.keys(changes).some((key) => /ratings$/i.test(key));
}

export function canApprove(proposal: Pick<AgentProposalInfo, 'warnings'>, acknowledged: boolean, busy: boolean): boolean {
  if (busy) return false;
  return proposal.warnings.length === 0 || acknowledged;
}

/** Human description of the target, e.g. "Diary · rowNumber 14". */
export function describeTarget(domain: string, target: unknown): string {
  const label = domain.charAt(0).toUpperCase() + domain.slice(1);
  if (!isRecord(target)) return label;
  const parts = Object.entries(target).map(([key, value]) => `${key} ${String(value)}`);
  return parts.length ? `${label} · ${parts.join(', ')}` : label;
}

/** Scope picker rows: one per domain, with the read/propose scopes that exist for it. */
export function scopeRows(): Array<{ domain: string; read: string | null; propose: string | null }> {
  const domains: string[] = [];
  for (const scope of SCOPES) {
    const domain = scope.split(':')[0];
    if (!domains.includes(domain)) domains.push(domain);
  }
  return domains.map((domain) => ({
    domain,
    read: (SCOPES as readonly string[]).includes(`${domain}:read`) ? `${domain}:read` : null,
    propose: (SCOPES as readonly string[]).includes(`${domain}:propose`) ? `${domain}:propose` : null,
  }));
}

/** The `~/.openclaw/openclaw.json` fragment shown once with the new token. */
export function openClawSnippet(token: string, baseUrl: string): string {
  return JSON.stringify({ skills: { entries: { nova: { enabled: true, apiKey: token, env: { NOVA_BASE_URL: baseUrl } } } } }, null, 2);
}

export function tokenState(token: Pick<AgentTokenInfo, 'revokedAt' | 'expiresAt'>, now: Date): 'active' | 'revoked' | 'expired' {
  if (token.revokedAt) return 'revoked';
  if (token.expiresAt && new Date(token.expiresAt).getTime() <= now.getTime()) return 'expired';
  return 'active';
}
