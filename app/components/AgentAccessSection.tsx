'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AGENT_PROPOSALS_CHANGED_EVENT,
  NOT_SET_UP_MESSAGE,
  approveProposalRequest,
  decisionAction,
  issueToken,
  loadPendingProposals,
  loadTokens,
  openClawSnippet,
  rejectProposalRequest,
  revokeToken,
  scopeRows,
  tokenState,
  unavailableMessage,
  type AdminLoad,
  type AgentProposalInfo,
  type AgentTokenInfo,
} from '@/lib/agent-admin-client';
import { AgentProposalCard, formatInstant, type ApproveRequest } from './AgentProposalCard';
import { ConfirmDialog } from './ConfirmDialog';
import { IconCheck, IconClipboard } from './Icons';
import { ModalDialog } from './ModalDialog';

type TokensData = { tokens: AgentTokenInfo[]; defaultExpiresInDays: number };
type Notice = { tone: 'info' | 'error'; text: string };

const smallButton =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition active:scale-95 disabled:opacity-50 sm:min-h-9';

const panel = 'rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4 sm:p-5';

export interface AgentAccessViewProps {
  tokensLoad: AdminLoad<TokensData> | null;
  proposalsLoad: AdminLoad<AgentProposalInfo[]> | null;
  now: Date | null;
  acknowledged: Record<string, boolean>;
  busyProposalId: string | null;
  proposalNotices: Record<string, Notice>;
  listNotice: Notice | null;
  onIssue: () => void;
  onRevoke: (token: AgentTokenInfo) => void;
  onAcknowledgedChange: (proposalId: string, value: boolean) => void;
  onApprove: (request: ApproveRequest) => void;
  onReject: (proposalId: string) => void;
  onRefresh: () => void;
}

function StateLine({ children, role = 'status' }: { children: React.ReactNode; role?: 'status' | 'alert' }) {
  return (
    <p role={role} className="mt-3 text-sm text-stone-600">
      {children}
    </p>
  );
}

const STATE_LABEL: Record<'active' | 'revoked' | 'expired', { text: string; className: string }> = {
  active: { text: 'Active', className: 'bg-mint-50 text-mint-800' },
  revoked: { text: 'Revoked', className: 'bg-stone-100 text-stone-700' },
  expired: { text: 'Expired', className: 'bg-peach-50 text-peach-800' },
};

function TokensPanel({ data, now, onIssue, onRevoke }: { data: TokensData; now: Date | null; onIssue: () => void; onRevoke: (token: AgentTokenInfo) => void }) {
  return (
    <section aria-labelledby="agent-tokens-title" className={panel}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h3 id="agent-tokens-title" className="text-base font-semibold text-stone-900">Tokens</h3>
        <button type="button" onClick={onIssue} className={`${smallButton} bg-stone-900 text-white hover:bg-stone-700`}>
          New token
        </button>
      </div>
      {data.tokens.length === 0 ? (
        <p className="mt-3 text-sm text-stone-600">No tokens yet. Create one to connect OpenClaw.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-200/70">
          {data.tokens.map((token) => {
            const state = now ? tokenState(token, now) : token.revokedAt ? 'revoked' : 'active';
            const label = STATE_LABEL[state];
            return (
              <li key={token.id} className="flex min-w-0 flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-900">
                    <span className="break-words">{token.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${label.className}`}>{label.text}</span>
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-stone-600">{token.prefix}…</p>
                  <p className="mt-1 break-words text-xs text-stone-600">{token.scopes.join(', ')}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    Created {formatInstant(token.createdAt)}
                    {' · '}
                    {token.expiresAt ? `expires ${formatInstant(token.expiresAt)}` : 'never expires'}
                    {' · '}
                    {token.lastUsedAt ? `last used ${formatInstant(token.lastUsedAt)}` : 'never used'}
                    {token.revokedAt ? ` · revoked ${formatInstant(token.revokedAt)}` : ''}
                  </p>
                </div>
                {state !== 'revoked' && (
                  <button
                    type="button"
                    onClick={() => onRevoke(token)}
                    aria-label={`Revoke token ${token.name}`}
                    className={`${smallButton} border border-stone-200 bg-white text-stone-700 hover:bg-rose-50 hover:text-rose-800`}
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RequestsPanel(props: Pick<AgentAccessViewProps, 'acknowledged' | 'busyProposalId' | 'proposalNotices' | 'listNotice' | 'onAcknowledgedChange' | 'onApprove' | 'onReject' | 'onRefresh'> & { load: AdminLoad<AgentProposalInfo[]> | null }) {
  const { load } = props;
  return (
    <section aria-labelledby="agent-requests-title" className={panel}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h3 id="agent-requests-title" className="text-base font-semibold text-stone-900">
          Agent requests
          {load?.kind === 'ok' && load.data.length > 0 && <span className="ml-2 text-sm font-medium text-stone-600">({load.data.length} waiting)</span>}
        </h3>
        <button type="button" onClick={props.onRefresh} className={`${smallButton} border border-stone-200 bg-white text-stone-700 hover:bg-stone-50`}>
          Refresh
        </button>
      </div>
      {props.listNotice && (
        <p role={props.listNotice.tone === 'error' ? 'alert' : 'status'} className="mt-3 rounded-xl bg-sky-50 p-3 text-sm text-stone-800">
          {props.listNotice.text}
        </p>
      )}
      {!load ? (
        <StateLine>Loading requests…</StateLine>
      ) : load.kind === 'unavailable' ? (
        <StateLine role="alert">{unavailableMessage(load)}</StateLine>
      ) : load.kind === 'missing' ? (
        <StateLine>{NOT_SET_UP_MESSAGE}</StateLine>
      ) : load.data.length === 0 ? (
        <p className="mt-3 text-sm text-stone-600">Nothing waiting. When the agent asks to change something, it shows up here for you to approve.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {load.data.map((proposal) => (
            <AgentProposalCard
              key={proposal.id}
              proposal={proposal}
              acknowledged={props.acknowledged[proposal.id] === true}
              busy={props.busyProposalId === proposal.id}
              notice={props.proposalNotices[proposal.id] ?? null}
              onAcknowledgedChange={props.onAcknowledgedChange}
              onApprove={props.onApprove}
              onReject={props.onReject}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Settings › AI agent access, presentational. When the agent tables are missing (either load says
 * so) the whole section shows only "Agent access is not set up on this database" (M11).
 */
export function AgentAccessView(props: AgentAccessViewProps) {
  const { tokensLoad, proposalsLoad } = props;
  const missing = tokensLoad?.kind === 'missing' || proposalsLoad?.kind === 'missing';
  let body: React.ReactNode;
  if (missing) {
    body = (
      <p role="status" className="mt-4 rounded-2xl bg-stone-50 p-4 text-sm text-stone-700">
        {NOT_SET_UP_MESSAGE}. Once the database migration is applied, you can connect an agent here.
      </p>
    );
  } else if (!tokensLoad) {
    body = <StateLine>Loading agent access…</StateLine>;
  } else if (tokensLoad.kind === 'unavailable') {
    body = <StateLine role={tokensLoad.status >= 500 || tokensLoad.status === 0 ? 'alert' : 'status'}>{unavailableMessage(tokensLoad)}</StateLine>;
  } else {
    body = (
      <div className="mt-4 space-y-4">
        <TokensPanel data={tokensLoad.data} now={props.now} onIssue={props.onIssue} onRevoke={props.onRevoke} />
        <RequestsPanel load={proposalsLoad} {...props} />
      </div>
    );
  }
  return (
    <section aria-labelledby="settings-agent-title" className="animate-fade-up stagger-3 mt-6 rounded-card bg-white p-6 shadow-soft sm:p-8">
      <h2 id="settings-agent-title" className="flex items-center gap-2 text-lg font-semibold text-stone-900">
        <span aria-hidden="true" className="inline-block size-2 rounded-full bg-lavender-300" />
        AI agent access
      </h2>
      <p className="mt-3 text-stone-600">
        Let your OpenClaw agent read your onboarding data and suggest changes. Nothing changes until you approve it here, and approved changes reach the spreadsheet only when you sync.
      </p>
      {body}
    </section>
  );
}

function IssueTokenDialog({
  isOpen,
  defaultDays,
  onClose,
  onIssued,
}: {
  isOpen: boolean;
  defaultDays: number;
  onClose: () => void;
  onIssued: () => void;
}) {
  const rows = scopeRows();
  const [name, setName] = useState('OpenClaw');
  const [scopes, setScopes] = useState<string[]>([]);
  const [days, setDays] = useState(defaultDays);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Show-once plaintext: component state only, never storage; dropped when the dialog closes.
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState<'token' | 'snippet' | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setName('OpenClaw');
    setScopes([]);
    setDays(defaultDays);
    setError(null);
    setPlaintext(null);
    setCopied(null);
  }, [isOpen, defaultDays]);

  function close() {
    setPlaintext(null);
    onClose();
  }

  function toggle(scope: string, on: boolean) {
    setScopes((current) => (on ? [...current.filter((s) => s !== scope), scope] : current.filter((s) => s !== scope)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!name.trim()) return setError('Give the token a name.');
    if (scopes.length === 0) return setError('Choose at least one permission.');
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const result = await issueToken({ name: name.trim(), scopes, expiresInDays: days });
    inFlight.current = false;
    setBusy(false);
    const data = result.data as { token?: unknown } | undefined;
    if (result.ok && data && typeof data.token === 'string') {
      setPlaintext(data.token);
      onIssued();
    } else {
      setError(result.message || 'Couldn’t create the token.');
    }
  }

  async function copy(kind: 'token' | 'snippet', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      setError('Copy failed. Select the text and copy it manually.');
    }
  }

  const snippet = plaintext ? openClawSnippet(plaintext, typeof window === 'undefined' ? '' : window.location.origin) : '';
  const dayOptions = Array.from(new Set([7, 30, 90, 180, 365, defaultDays])).filter((d) => d >= 1 && d <= 365).sort((a, b) => a - b);

  return (
    <ModalDialog
      isOpen={isOpen}
      onClose={close}
      dismissible={!busy}
      maxWidth="lg"
      title={plaintext ? 'Copy your new token' : 'New agent token'}
      description={plaintext ? 'This is the only time the token is shown. Store it in OpenClaw now.' : 'Choose what the agent may read and what it may suggest. It can never change anything without your approval.'}
      footer={
        plaintext ? (
          <button type="button" onClick={close} className={`${smallButton} bg-stone-900 text-white hover:bg-stone-700`}>
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={close} disabled={busy} className={`${smallButton} text-stone-600 hover:bg-stone-200`}>
              Cancel
            </button>
            <button type="submit" form="agent-issue-form" disabled={busy} className={`${smallButton} bg-stone-900 text-white hover:bg-stone-700`}>
              {busy ? 'Creating…' : 'Create token'}
            </button>
          </>
        )
      }
    >
      {plaintext ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="agent-token-plaintext" className="text-xs font-semibold text-stone-700">Token</label>
            <textarea
              id="agent-token-plaintext"
              readOnly
              rows={2}
              value={plaintext}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-1 w-full resize-none rounded-xl border border-stone-200 bg-stone-50 p-3 font-mono text-xs text-stone-900"
            />
            <button type="button" onClick={() => void copy('token', plaintext)} className={`${smallButton} mt-2 border border-stone-200 bg-white text-stone-700 hover:bg-stone-50`}>
              {copied === 'token' ? <IconCheck className="h-3.5 w-3.5" /> : <IconClipboard className="h-3.5 w-3.5" />}
              {copied === 'token' ? 'Copied' : 'Copy token'}
            </button>
          </div>
          <div>
            <label htmlFor="agent-token-snippet" className="text-xs font-semibold text-stone-700">For ~/.openclaw/openclaw.json</label>
            <textarea
              id="agent-token-snippet"
              readOnly
              rows={10}
              value={snippet}
              onFocus={(event) => event.currentTarget.select()}
              className="mt-1 w-full resize-none rounded-xl border border-stone-200 bg-stone-50 p-3 font-mono text-xs text-stone-900"
            />
            <button type="button" onClick={() => void copy('snippet', snippet)} className={`${smallButton} mt-2 border border-stone-200 bg-white text-stone-700 hover:bg-stone-50`}>
              {copied === 'snippet' ? <IconCheck className="h-3.5 w-3.5" /> : <IconClipboard className="h-3.5 w-3.5" />}
              {copied === 'snippet' ? 'Copied' : 'Copy config'}
            </button>
          </div>
          <p role="status" className="text-xs text-stone-600">{copied ? 'Copied to the clipboard.' : ''}</p>
          {error && <p role="alert" className="text-sm text-peach-800">{error}</p>}
        </div>
      ) : (
        <form id="agent-issue-form" onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="agent-token-name" className="text-xs font-semibold text-stone-700">Name</label>
            <input
              id="agent-token-name"
              type="text"
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-900"
            />
          </div>
          <fieldset>
            <legend className="text-xs font-semibold text-stone-700">Permissions</legend>
            <div className="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-200">
              {rows.map((row) => (
                <div key={row.domain} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                  <span className="text-sm font-medium capitalize text-stone-800">{row.domain}</span>
                  <span className="flex flex-wrap gap-4">
                    {([['read', 'Read'], ['propose', 'Suggest changes']] as const).map(([kind, label]) => {
                      const scope = row[kind];
                      if (!scope) return null;
                      return (
                        <label key={scope} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-stone-700 sm:min-h-9">
                          <input
                            type="checkbox"
                            checked={scopes.includes(scope)}
                            onChange={(event) => toggle(scope, event.target.checked)}
                            aria-label={`${row.domain}: ${label}`}
                            className="size-4 accent-stone-900"
                          />
                          {label}
                        </label>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="agent-token-expiry" className="text-xs font-semibold text-stone-700">Expires after</label>
            <select
              id="agent-token-expiry"
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="mt-1 min-h-11 w-full rounded-xl border border-stone-200 bg-white px-3 text-sm text-stone-900"
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d} days{d === defaultDays ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </div>
          {error && <p role="alert" className="text-sm text-peach-800">{error}</p>}
        </form>
      )}
    </ModalDialog>
  );
}

function notifyProposalsChanged() {
  window.dispatchEvent(new Event(AGENT_PROPOSALS_CHANGED_EVENT));
}

/** Settings › AI agent access: loads tokens and pending requests, runs issue/revoke/approve/reject. */
export function AgentAccessSection() {
  const [tokensLoad, setTokensLoad] = useState<AdminLoad<TokensData> | null>(null);
  const [proposalsLoad, setProposalsLoad] = useState<AdminLoad<AgentProposalInfo[]> | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [proposalNotices, setProposalNotices] = useState<Record<string, Notice>>({});
  const [listNotice, setListNotice] = useState<Notice | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [revoking, setRevoking] = useState<AgentTokenInfo | null>(null);
  const [revokeNotice, setRevokeNotice] = useState<Notice | null>(null);

  const refreshTokens = useCallback(async () => {
    setTokensLoad(await loadTokens());
    setNow(new Date());
  }, []);

  const refreshProposals = useCallback(async () => {
    const load = await loadPendingProposals();
    setProposalsLoad(load);
    if (load.kind === 'ok') {
      const ids = new Set(load.data.map((p) => p.id));
      setAcknowledged((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
      setProposalNotices((current) => Object.fromEntries(Object.entries(current).filter(([id]) => ids.has(id))));
    }
    notifyProposalsChanged();
  }, []);

  useEffect(() => {
    void refreshTokens();
    void refreshProposals();
  }, [refreshTokens, refreshProposals]);

  function replaceProposal(updated: AgentProposalInfo) {
    setProposalsLoad((load) => (load?.kind === 'ok' ? { kind: 'ok', data: load.data.map((p) => (p.id === updated.id ? updated : p)) } : load));
  }

  async function decide(kind: 'approve' | 'reject', proposal: AgentProposalInfo, request?: ApproveRequest) {
    if (busyProposalId) return;
    setBusyProposalId(proposal.id);
    setListNotice(null);
    const result =
      kind === 'approve'
        ? await approveProposalRequest({ ...proposal, expectedUpdatedAt: request?.expectedUpdatedAt ?? proposal.expectedUpdatedAt }, request?.acknowledgeWarnings === true)
        : await rejectProposalRequest(proposal);
    const action = decisionAction(kind, result);
    setBusyProposalId(null);
    if (action.kind === 'stale') {
      // Re-render with the refreshed `before`/`expectedUpdatedAt`; the owner must approve again.
      replaceProposal(action.proposal);
      setAcknowledged((current) => ({ ...current, [proposal.id]: false }));
      setProposalNotices((current) => ({ ...current, [proposal.id]: { tone: 'info', text: action.message } }));
    } else if (action.kind === 'error') {
      setProposalNotices((current) => ({ ...current, [proposal.id]: { tone: 'error', text: action.message } }));
    } else {
      setListNotice({ tone: 'info', text: action.message });
      await refreshProposals();
    }
  }

  function findProposal(id: string): AgentProposalInfo | undefined {
    return proposalsLoad?.kind === 'ok' ? proposalsLoad.data.find((p) => p.id === id) : undefined;
  }

  async function confirmRevoke(token: AgentTokenInfo) {
    const result = await revokeToken(token.id);
    const data = result.data as { cancelledProposalIds?: unknown } | undefined;
    const cancelled = Array.isArray(data?.cancelledProposalIds) ? data.cancelledProposalIds.length : 0;
    setRevokeNotice(
      result.ok
        ? { tone: 'info', text: `Revoked “${token.name}”.${cancelled ? ` ${cancelled} waiting request${cancelled === 1 ? ' was' : 's were'} cancelled.` : ''}` }
        : { tone: 'error', text: result.message || 'Couldn’t revoke the token.' }
    );
    await refreshTokens();
    await refreshProposals();
  }

  const defaultDays = tokensLoad?.kind === 'ok' ? tokensLoad.data.defaultExpiresInDays : 90;

  return (
    <>
      <AgentAccessView
        tokensLoad={tokensLoad}
        proposalsLoad={proposalsLoad}
        now={now}
        acknowledged={acknowledged}
        busyProposalId={busyProposalId}
        proposalNotices={proposalNotices}
        listNotice={revokeNotice ?? listNotice}
        onIssue={() => {
          setRevokeNotice(null);
          setIssueOpen(true);
        }}
        onRevoke={(token) => setRevoking(token)}
        onAcknowledgedChange={(id, value) => setAcknowledged((current) => ({ ...current, [id]: value }))}
        onApprove={(request) => {
          const proposal = findProposal(request.proposalId);
          if (proposal) void decide('approve', proposal, request);
        }}
        onReject={(id) => {
          const proposal = findProposal(id);
          if (proposal) void decide('reject', proposal);
        }}
        onRefresh={() => {
          setListNotice(null);
          setRevokeNotice(null);
          void refreshTokens();
          void refreshProposals();
        }}
      />
      <IssueTokenDialog isOpen={issueOpen} defaultDays={defaultDays} onClose={() => setIssueOpen(false)} onIssued={() => void refreshTokens()} />
      <ConfirmDialog
        isOpen={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) void confirmRevoke(revoking);
        }}
        title="Revoke this token?"
        message={
          revoking
            ? `“${revoking.name}” stops working right away, and any of its requests still waiting for you are cancelled. This can’t be undone; create a new token to reconnect.`
            : ''
        }
        confirmLabel="Revoke token"
        variant="danger"
      />
    </>
  );
}
