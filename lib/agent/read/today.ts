/**
 * Agent `/today` view, built on the database schedule projection (`./schedule`) only (M9).
 * Done = sheet progress `Done` (the database has no browser session history).
 */
import { isSameJakartaDate, jakartaDateParts } from '@/lib/format-date';
import { isScheduleActivityDone } from '@/lib/schedule-view';
import { nextUpcomingActivity, onboardingDayNumber } from '@/lib/today-view';
import type { AgentScheduleItem } from './schedule';

export interface AgentTodayView {
  /** Asia/Jakarta calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Onboarding "Day N" (Day 1 is the start date). */
  dayNumber: number;
  /** The in-progress activity scheduled today, else the first open one; null when none is open. */
  current: AgentScheduleItem | null;
  /**
   * Today's other open activities in schedule order. When nothing is scheduled today, the single
   * next open activity (first open item dated today or later, else the first open item).
   */
  upcoming: AgentScheduleItem[];
  /** Today's activities whose progress is `Done`. */
  done: AgentScheduleItem[];
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function buildTodayView(items: readonly AgentScheduleItem[], now: Date): AgentTodayView {
  const parts = jakartaDateParts(now);
  const todays = items.filter((item) => isSameJakartaDate(item.date ?? '', now));
  const done = todays.filter(isScheduleActivityDone);
  const open = todays.filter((item) => !isScheduleActivityDone(item));
  const current = open.find((item) => item.progress === 'In Progress') ?? open[0] ?? null;

  let upcoming: AgentScheduleItem[];
  if (todays.length > 0) {
    upcoming = open.filter((item) => item !== current);
  } else {
    const next = nextUpcomingActivity(items, now, isScheduleActivityDone);
    upcoming = next ? [next] : [];
  }

  return {
    date: `${parts.y}-${pad2(parts.m)}-${pad2(parts.d)}`,
    dayNumber: onboardingDayNumber(now),
    current,
    upcoming,
    done,
  };
}
