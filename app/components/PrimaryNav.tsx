'use client';

import { useEffect, useState } from 'react';
import { AGENT_PROPOSALS_CHANGED_EVENT, loadPendingCount } from '@/lib/agent-admin-client';

/**
 * PrimaryNav has been migrated to the persistent AppShell sidebar navigation
 * (app/components/AppShell.tsx).
 *
 * This file is retained for backwards compatibility and type exports.
 */

export const destinations = [
  { label: 'Today', href: '/' },
  { label: 'Schedule', href: '/schedule' },
  { label: 'Timeline', href: '/timeline' },
  { label: 'Diary', href: '/diary' },
  { label: 'Feedback', href: '/feedback' },
  { label: 'Reviews', href: '/reviews' },
  { label: 'Glossary', href: '/glossary' },
  { label: 'Settings', href: '/settings' },
] as const;

export type NavTab =
  | 'Today'
  | 'Schedule'
  | 'Timeline'
  | 'Diary'
  | 'Feedback'
  | 'Reviews'
  | 'Glossary'
  | 'Settings'
  | 'Journey'
  | 'Learnings';

export function PrimaryNav(_props: { active?: NavTab }) {
  // Navigation is now handled by the persistent sidebar AppShell
  return null;
}

/** Pending agent-request count next to the Settings nav item; renders nothing for null/0. */
export function AgentPendingBadgeView({ count }: { count: number | null }) {
  if (!count || count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <span className="ml-auto mr-1 inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-lavender-100 px-1.5 text-[11px] font-bold text-lavender-900">
      {label}
      <span className="sr-only"> agent request{count === 1 ? '' : 's'} waiting for approval</span>
    </span>
  );
}

/**
 * Pending agent-request count for the optional nav badge (`GET /api/agent-admin/proposals?countOnly=1`).
 * Quiet by design: any failure, a non-owner session, Sheets mode, or missing agent tables
 * (`agent_tables_missing`) yields null. Refreshes on mount, on window focus, and when Settings
 * reports a decision.
 */
export function useAgentPendingCount(enabled = true): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refresh = () => {
      void loadPendingCount().then((value) => {
        if (active) setCount(value);
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(AGENT_PROPOSALS_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener(AGENT_PROPOSALS_CHANGED_EVENT, refresh);
    };
  }, [enabled]);
  return enabled ? count : null;
}
