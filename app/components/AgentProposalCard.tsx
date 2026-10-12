'use client';

import React from 'react';
import {
  FORMULA_ACK_LABEL,
  RATINGS_SOURCE_TEXT,
  approveBody,
  canApprove,
  describeTarget,
  describeWarning,
  diffRows,
  touchesRatings,
  type AgentProposalInfo,
} from '@/lib/agent-admin-client';
import { formatDisplayDate, formatJakartaTime } from '@/lib/format-date';
import { IconAlertTriangle, IconSparkles } from './Icons';

export interface ApproveRequest {
  proposalId: string;
  expectedUpdatedAt: string | null;
  acknowledgeWarnings?: boolean;
}

export interface AgentProposalCardProps {
  proposal: AgentProposalInfo;
  acknowledged: boolean;
  busy: boolean;
  notice?: { tone: 'info' | 'error'; text: string } | null;
  onAcknowledgedChange: (proposalId: string, value: boolean) => void;
  /** Receives exactly the `expectedUpdatedAt` of the proposal this card rendered. */
  onApprove: (request: ApproveRequest) => void;
  onReject: (proposalId: string) => void;
}

export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${formatDisplayDate(date)}, ${formatJakartaTime(date)}`;
}

function domIdPart(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

const valueBox = 'mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl p-3 font-mono text-xs leading-relaxed';

/**
 * One pending agent request: reason, the full current/proposed values per field (never a summary),
 * warnings with a required acknowledgement, the ADR-0003 ratings callout, and approve/decline.
 * Hook-free on purpose so it renders with react-dom/server in tests.
 */
export function AgentProposalCard({
  proposal,
  acknowledged,
  busy,
  notice,
  onAcknowledgedChange,
  onApprove,
  onReject,
}: AgentProposalCardProps) {
  const idPart = domIdPart(proposal.id);
  const titleId = `agent-proposal-${idPart}-title`;
  const warningId = `agent-proposal-${idPart}-warning`;
  const ackId = `agent-proposal-${idPart}-ack`;
  const rows = diffRows(proposal);
  const isDelete = proposal.operation === 'delete';
  const hasWarnings = proposal.warnings.length > 0;
  const approvable = canApprove(proposal, acknowledged, busy);
  const body = approveBody(proposal, acknowledged);

  return (
    <article
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      data-proposal-id={proposal.id}
      className="rounded-2xl border border-stone-200/80 bg-white p-4 sm:p-5"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={titleId} className="text-base font-semibold text-stone-900">
            {isDelete ? 'Delete' : 'Change'} · {describeTarget(proposal.domain, proposal.target)}
          </h4>
          <p className="mt-0.5 text-xs text-stone-500">
            From {proposal.tokenName ?? 'an agent token'}
            {proposal.tokenPrefix ? <span className="font-mono"> ({proposal.tokenPrefix}…)</span> : null}
            {' · '}asked {formatInstant(proposal.createdAt)}
            {' · '}expires {formatInstant(proposal.expiresAt)}
          </p>
        </div>
      </header>

      <div className="mt-3 rounded-xl bg-lavender-50 p-3">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-lavender-800">
          <IconSparkles className="h-3.5 w-3.5" aria-hidden="true" /> Agent’s reason
        </p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-800">{proposal.reason}</p>
      </div>

      {touchesRatings(proposal) && (
        <div role="note" className="mt-3 rounded-xl border border-sun-200 bg-sun-50 p-3 text-sm text-sun-900">
          <p className="font-semibold">
            Ratings {proposal.ratingsSource ? `marked “${proposal.ratingsSource}”` : 'included'}
          </p>
          <p className="mt-1">{RATINGS_SOURCE_TEXT}</p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {rows.length === 0 && <p className="text-sm text-stone-600">No fields listed.</p>}
        {rows.map((row) => (
          <section key={row.field} aria-label={`Field ${row.field}`} className="min-w-0">
            <h5 className="font-mono text-xs font-semibold text-stone-700">{row.field}</h5>
            <dl className="mt-1 grid min-w-0 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs font-medium text-stone-600">Now</dt>
                <dd className={`${valueBox} bg-stone-50 text-stone-800`}>
                  {row.hasBefore ? (
                    row.before === '' ? <span className="italic text-stone-500">(empty)</span> : row.before
                  ) : (
                    <span className="font-sans italic text-stone-500">No saved entry yet</span>
                  )}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium text-lavender-800">{isDelete ? 'After deleting' : 'Proposed'}</dt>
                <dd className={`${valueBox} bg-lavender-50 text-stone-900`}>
                  {isDelete ? (
                    <span className="font-sans italic text-stone-600">Removed (back to the default)</span>
                  ) : row.after === '' ? (
                    <span className="italic text-stone-500">(empty)</span>
                  ) : (
                    row.after
                  )}
                </dd>
              </div>
            </dl>
          </section>
        ))}
      </div>

      {hasWarnings && (
        <div id={warningId} className="mt-4 rounded-xl border border-peach-200 bg-peach-50 p-3 text-sm text-peach-900">
          <p className="flex items-start gap-2 font-semibold">
            <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-peach-700" aria-hidden="true" />
            <span>Check before approving</span>
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-6">
            {proposal.warnings.map((warning) => (
              <li key={warning}>{describeWarning(warning)}</li>
            ))}
          </ul>
          <label htmlFor={ackId} className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 font-medium text-stone-800 sm:min-h-9">
            <input
              id={ackId}
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => onAcknowledgedChange(proposal.id, event.target.checked)}
              className="size-4 shrink-0 accent-stone-900"
            />
            {FORMULA_ACK_LABEL}
          </label>
        </div>
      )}

      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`mt-3 rounded-xl p-3 text-sm ${notice.tone === 'error' ? 'bg-peach-50 text-peach-900' : 'bg-sky-50 text-stone-800'}`}
        >
          {notice.text}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          data-action="reject"
          disabled={busy}
          onClick={() => onReject(proposal.id)}
          className="inline-flex min-h-11 items-center rounded-full border border-stone-200 bg-white px-4 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-50 sm:min-h-9"
        >
          Decline
        </button>
        <button
          type="button"
          data-action="approve"
          disabled={!approvable}
          aria-describedby={hasWarnings ? warningId : undefined}
          onClick={() => onApprove({ proposalId: proposal.id, ...body })}
          className="inline-flex min-h-11 items-center rounded-full bg-stone-900 px-5 text-xs font-semibold text-white transition hover:bg-stone-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9"
        >
          {busy ? 'Working…' : isDelete ? 'Approve delete' : 'Approve change'}
        </button>
      </div>
    </article>
  );
}
