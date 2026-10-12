/**
 * Settings › AI agent access: the approval card and section states. The repo has no DOM test
 * environment, so the presentational components are rendered with react-dom/server and the hook-free
 * card's element tree is inspected directly to fire its Approve handler.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentProposalCard, type AgentProposalCardProps, type ApproveRequest } from './AgentProposalCard';
import { AgentAccessView, type AgentAccessViewProps } from './AgentAccessSection';
import { AgentPendingBadgeView } from './PrimaryNav';
import {
  FORMULA_ACK_LABEL,
  NOT_SET_UP_MESSAGE,
  RATINGS_SOURCE_TEXT,
  approveProposalRequest,
  badgeCount,
  decisionAction,
  diffRows,
  interpretAdminLoad,
  loadPendingCount,
  openClawSnippet,
  type AgentProposalInfo,
  type PostResult,
} from '@/lib/agent-admin-client';

const LONG_NOTE = Array.from({ length: 60 }, (_, i) => `line ${i} of the full learned text, never summarised`).join('\n');

function proposal(overrides: Partial<AgentProposalInfo> = {}): AgentProposalInfo {
  return {
    id: 'prp_1',
    domain: 'diary',
    operation: 'update',
    target: { rowNumber: 14 },
    changes: { learned: LONG_NOTE, notes: '=SUM(A1:A3)' },
    before: { learned: 'old learned text', notes: 'old notes' },
    expectedUpdatedAt: '2026-09-01T00:00:00.000Z',
    warnings: ['formula_like:notes'],
    ratingsSource: null,
    reason: 'You told me what you learned in the security session.',
    status: 'pending',
    createdAt: '2026-10-12T02:00:00.000Z',
    expiresAt: '2026-10-13T02:00:00.000Z',
    tokenName: 'OpenClaw',
    tokenPrefix: 'nova_agt_abcdefgh',
    ...overrides,
  };
}

function cardProps(overrides: Partial<AgentProposalCardProps> = {}): AgentProposalCardProps {
  return {
    proposal: proposal(),
    acknowledged: false,
    busy: false,
    notice: null,
    onAcknowledgedChange: () => undefined,
    onApprove: () => undefined,
    onReject: () => undefined,
    ...overrides,
  };
}

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

function decode(html: string): string {
  return html.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

type AnyElement = React.ReactElement<Record<string, unknown>>;

/** Host elements in the tree returned by a hook-free component (function children not expanded). */
function findAll(node: unknown, predicate: (element: AnyElement) => boolean, out: AnyElement[] = []): AnyElement[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (!React.isValidElement(node)) return out;
  const element = node as AnyElement;
  if (predicate(element)) out.push(element);
  findAll(element.props.children, predicate, out);
  return out;
}

function approveButtonHtml(html: string): string {
  const match = /<button[^>]*data-action="approve"[^>]*>/.exec(html);
  if (!match) throw new Error('no approve button rendered');
  return match[0];
}

describe('AgentProposalCard', () => {
  it('renders the reason and the full before/changes for every field, never a summary', () => {
    const html = decode(render(<AgentProposalCard {...cardProps()} />));
    expect(html).toContain('You told me what you learned in the security session.');
    expect(html).toContain(LONG_NOTE); // all 60 lines, verbatim
    expect(html).toContain('old learned text');
    expect(html).toContain('=SUM(A1:A3)');
    expect(html).toContain('old notes');
    expect(html).toContain('Diary · rowNumber 14');
    expect(diffRows(proposal()).map((r) => r.field)).toEqual(['learned', 'notes']);
  });

  it('shows nested ratings objects in full and the ADR-0003 ratingsSource callout', () => {
    const ratings = { communication: 5, alignment: 6, understanding: 4, readiness: 5, pace: 3, overall: 5 };
    const p = proposal({
      domain: 'feedback',
      target: { sessionId: 'row-3' },
      changes: { ratings },
      before: { ratings: { communication: 1, alignment: 1, understanding: 1, readiness: 1, pace: 1, overall: 1 } },
      warnings: [],
      ratingsSource: 'user-dictated',
    });
    const html = decode(render(<AgentProposalCard {...cardProps({ proposal: p })} />));
    expect(html).toContain(RATINGS_SOURCE_TEXT);
    expect(html).toContain('user-dictated');
    expect(html).toContain(JSON.stringify(ratings, null, 2));
    expect(html).toContain('"communication": 1');
    expect(html).toContain('role="note"');
  });

  it('renders "No saved entry yet" when before is null and the full current values for a delete', () => {
    const absent = decode(render(<AgentProposalCard {...cardProps({ proposal: proposal({ before: null, expectedUpdatedAt: null, warnings: [] }) })} />));
    expect(absent).toContain('No saved entry yet');
    const del = decode(
      render(<AgentProposalCard {...cardProps({ proposal: proposal({ operation: 'delete', changes: {}, warnings: [], before: { learned: LONG_NOTE, notes: 'n' } }) })} />)
    );
    expect(del).toContain(LONG_NOTE);
    expect(del).toContain('Removed (back to the default)');
    expect(del).toContain('Approve delete');
  });

  it('renders warnings with the required checkbox and disables Approve until it is ticked', () => {
    const unticked = decode(render(<AgentProposalCard {...cardProps({ acknowledged: false })} />));
    expect(unticked).toContain('“notes” starts with =, +, -, @, a tab or a line break');
    expect(unticked).toContain(FORMULA_ACK_LABEL);
    expect(unticked).toMatch(/<input[^>]*type="checkbox"/);
    expect(approveButtonHtml(unticked)).toContain('disabled=""');
    expect(approveButtonHtml(unticked)).toContain('aria-describedby="agent-proposal-prp_1-warning"');

    const ticked = render(<AgentProposalCard {...cardProps({ acknowledged: true })} />);
    expect(approveButtonHtml(ticked)).not.toContain('disabled=""');

    const noWarnings = render(<AgentProposalCard {...cardProps({ proposal: proposal({ warnings: [] }) })} />);
    expect(noWarnings).not.toContain(FORMULA_ACK_LABEL);
    expect(approveButtonHtml(noWarnings)).not.toContain('disabled=""');
    expect(approveButtonHtml(render(<AgentProposalCard {...cardProps({ busy: true, proposal: proposal({ warnings: [] }) })} />))).toContain('disabled=""');
  });

  it('the checkbox reports changes for this proposal', () => {
    const changes: Array<[string, boolean]> = [];
    const tree = AgentProposalCard(cardProps({ onAcknowledgedChange: (id, value) => changes.push([id, value]) }));
    const [checkbox] = findAll(tree, (el) => el.type === 'input' && el.props.type === 'checkbox');
    (checkbox.props.onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: true } });
    expect(changes).toEqual([['prp_1', true]]);
  });

  it('Approve calls back with the displayed expectedUpdatedAt and the acknowledgement', () => {
    const calls: ApproveRequest[] = [];
    const tree = AgentProposalCard(cardProps({ acknowledged: true, onApprove: (r) => calls.push(r) }));
    const [approve] = findAll(tree, (el) => el.type === 'button' && el.props['data-action'] === 'approve');
    (approve.props.onClick as () => void)();
    expect(calls).toEqual([{ proposalId: 'prp_1', expectedUpdatedAt: '2026-09-01T00:00:00.000Z', acknowledgeWarnings: true }]);

    // A refreshed (stale) proposal re-renders and approve then carries the refreshed value.
    const refreshed = proposal({ expectedUpdatedAt: '2026-10-12T05:00:00.000Z', before: { learned: 'changed meanwhile', notes: 'x' }, warnings: [] });
    const notice = { tone: 'info' as const, text: 'This entry changed since the agent asked.' };
    const html = decode(render(<AgentProposalCard {...cardProps({ proposal: refreshed, notice })} />));
    expect(html).toContain('changed meanwhile');
    expect(html).toContain('This entry changed since the agent asked.');
    const tree2 = AgentProposalCard(cardProps({ proposal: refreshed, onApprove: (r) => calls.push(r) }));
    const [approve2] = findAll(tree2, (el) => el.type === 'button' && el.props['data-action'] === 'approve');
    (approve2.props.onClick as () => void)();
    expect(calls[1]).toEqual({ proposalId: 'prp_1', expectedUpdatedAt: '2026-10-12T05:00:00.000Z' });

    // null (row absent when proposed) is sent as null, not omitted.
    const tree3 = AgentProposalCard(cardProps({ proposal: proposal({ expectedUpdatedAt: null, before: null, warnings: [] }), onApprove: (r) => calls.push(r) }));
    const [approve3] = findAll(tree3, (el) => el.type === 'button' && el.props['data-action'] === 'approve');
    (approve3.props.onClick as () => void)();
    expect(calls[2]).toEqual({ proposalId: 'prp_1', expectedUpdatedAt: null });
  });

  it('Decline calls back with the proposal id', () => {
    const ids: string[] = [];
    const tree = AgentProposalCard(cardProps({ onReject: (id) => ids.push(id) }));
    const [decline] = findAll(tree, (el) => el.type === 'button' && el.props['data-action'] === 'reject');
    (decline.props.onClick as () => void)();
    expect(ids).toEqual(['prp_1']);
  });
});

describe('approve request and decision handling', () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const impl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
    return { calls, impl };
  }

  it('POSTs the displayed expectedUpdatedAt same-origin with a JSON content type', async () => {
    const f = fakeFetch(200, { ok: true, data: { status: 'executed', idempotent: false } });
    const result = await approveProposalRequest(proposal(), true, f.impl);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].url).toBe('/api/agent-admin/proposals/prp_1/approve');
    expect(f.calls[0].init?.method).toBe('POST');
    expect(f.calls[0].init?.credentials).toBe('same-origin');
    expect(f.calls[0].init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ expectedUpdatedAt: '2026-09-01T00:00:00.000Z', acknowledgeWarnings: true });
    expect(decisionAction('approve', result).kind).toBe('done');
  });

  function post(status: number, body: Record<string, unknown>): PostResult {
    return { status, ok: body.ok === true, error: typeof body.error === 'string' ? body.error : null, message: String(body.message ?? ''), data: body.data, body };
  }

  it('stale -> re-render with the refreshed proposal; stale_client -> reload; others map to reload/error', () => {
    const refreshed = proposal({ expectedUpdatedAt: 'new', before: { learned: 'fresh' } });
    const stale = decisionAction('approve', post(409, { ok: false, error: 'stale', status: 'pending', proposal: refreshed }));
    expect(stale.kind).toBe('stale');
    expect(stale.kind === 'stale' && stale.proposal.expectedUpdatedAt).toBe('new');
    expect(decisionAction('approve', post(409, { ok: false, error: 'stale_client' })).kind).toBe('reload');
    for (const error of ['token_revoked', 'expired', 'target_missing', 'proposal_not_pending', 'not_found']) {
      expect(decisionAction('approve', post(409, { ok: false, error })).kind).toBe('reload');
    }
    expect(decisionAction('approve', post(422, { ok: false, error: 'warnings_not_acknowledged' })).kind).toBe('error');
    expect(decisionAction('approve', post(500, { ok: false, error: 'internal_error', message: 'The request failed.' }))).toEqual({ kind: 'error', message: 'The request failed.' });
    expect(decisionAction('reject', post(200, { ok: true, data: { status: 'rejected' } })).kind).toBe('done');
  });
});

describe('AgentAccessView states', () => {
  const noop = () => undefined;
  function viewProps(overrides: Partial<AgentAccessViewProps>): AgentAccessViewProps {
    return {
      tokensLoad: null,
      proposalsLoad: null,
      now: null,
      acknowledged: {},
      busyProposalId: null,
      proposalNotices: {},
      listNotice: null,
      onIssue: noop,
      onRevoke: noop,
      onAcknowledgedChange: noop,
      onApprove: noop,
      onReject: noop,
      onRefresh: noop,
      ...overrides,
    };
  }

  it('renders the quiet "not set up" state when the agent tables are missing', () => {
    for (const props of [{ tokensLoad: { kind: 'missing' as const } }, { proposalsLoad: { kind: 'missing' as const } }]) {
      const html = render(<AgentAccessView {...viewProps(props)} />);
      expect(html).toContain(NOT_SET_UP_MESSAGE);
      expect(html).toContain('AI agent access');
      expect(html).not.toContain('New token');
      expect(html).not.toContain('role="alert"');
    }
    expect(interpretAdminLoad(200, { ok: false, error: 'agent_tables_missing', message: 'x' }, () => [])).toEqual({ kind: 'missing' });
  });

  it('renders tokens (no plaintext, prefix only) and the pending requests', () => {
    const html = decode(
      render(
        <AgentAccessView
          {...viewProps({
            now: new Date('2026-10-12T03:00:00Z'),
            tokensLoad: {
              kind: 'ok',
              data: {
                defaultExpiresInDays: 90,
                tokens: [
                  { id: 'tok_1', name: 'Laptop', prefix: 'nova_agt_abcdefgh', scopes: ['diary:read', 'diary:propose'], createdAt: '2026-10-01T00:00:00Z', expiresAt: '2026-12-30T00:00:00Z', lastUsedAt: null, revokedAt: null },
                  { id: 'tok_2', name: 'Old', prefix: 'nova_agt_zzzzzzzz', scopes: ['glossary:read'], createdAt: '2026-09-01T00:00:00Z', expiresAt: null, lastUsedAt: null, revokedAt: '2026-10-02T00:00:00Z' },
                ],
              },
            },
            proposalsLoad: { kind: 'ok', data: [proposal()] },
          })}
        />
      )
    );
    expect(html).toContain('Laptop');
    expect(html).toContain('nova_agt_abcdefgh…');
    expect(html).toContain('Revoke token Laptop');
    expect(html).not.toContain('Revoke token Old'); // revoked tokens have no revoke button
    expect(html).toContain('Revoked');
    expect(html).toContain('(1 waiting)');
    expect(html).toContain(FORMULA_ACK_LABEL);
  });

  it('explains why access is unavailable (e.g. not the owner) without the cards', () => {
    const html = render(<AgentAccessView {...viewProps({ tokensLoad: { kind: 'unavailable', status: 403, error: 'not_owner', message: 'x' } })} />);
    expect(html).toContain('This account is not allowed to manage agent access.');
    expect(html).not.toContain('New token');
  });
});

describe('nav badge and snippet', () => {
  it('badge renders nothing for null/0 and an accessible count otherwise', () => {
    expect(render(<AgentPendingBadgeView count={null} />)).toBe('');
    expect(render(<AgentPendingBadgeView count={0} />)).toBe('');
    const html = render(<AgentPendingBadgeView count={3} />);
    expect(html).toContain('>3<');
    expect(html).toContain('agent requests waiting for approval');
  });

  it('badgeCount degrades quietly (tables missing, 403, 503, malformed) and loadPendingCount never throws', async () => {
    expect(badgeCount(200, { ok: true, data: { count: 2 } })).toBe(2);
    expect(badgeCount(200, { ok: false, error: 'agent_tables_missing' })).toBeNull();
    expect(badgeCount(403, { ok: false, error: 'not_owner' })).toBeNull();
    expect(badgeCount(503, null)).toBeNull();
    expect(badgeCount(200, { ok: true, data: { count: '2' } })).toBeNull();
    const failing = async () => {
      throw new Error('offline');
    };
    expect(await loadPendingCount(failing)).toBeNull();
    const calls: string[] = [];
    await loadPendingCount(async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ ok: true, data: { count: 1 } }), { status: 200 });
    });
    expect(calls).toEqual(['/api/agent-admin/proposals?countOnly=1']);
  });

  it('openclaw.json snippet carries the token and base URL', () => {
    expect(JSON.parse(openClawSnippet('nova_agt_x', 'https://app.example'))).toEqual({
      skills: { entries: { nova: { enabled: true, apiKey: 'nova_agt_x', env: { NOVA_BASE_URL: 'https://app.example' } } } },
    });
  });
});
