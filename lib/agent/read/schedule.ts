/**
 * Agent schedule projection: a direct `activities` select ordered by `row_number`, mapped with
 * `scheduleActivityToActivity` exactly as the database branch of the app's schedule reader does.
 * Database only: no Sheets proxy and no hardcoded catalog fallback (M9). `/today` builds on this.
 */
import { asc, eq, sql } from 'drizzle-orm';
import { activities } from '@/lib/db/schema';
import { parseSheetDate } from '@/lib/format-date';
import { scheduleActivityToActivity, type ScheduleActivity } from '@/lib/schedule-catalog';
import type { Activity } from '@/lib/types/activity';
import type { AgentExecutor } from '../audit';
import { parseIsoDate, type Parsed, badQuery } from './query';

/** Columns read for the projection; `updatedAt` is `updated_at::text` to keep microseconds (M4). */
export const SCHEDULE_SELECTION = {
  id: activities.id,
  rowNumber: activities.rowNumber,
  week: activities.week,
  day: activities.day,
  date: activities.date,
  activityCount: activities.activityCount,
  pic: activities.pic,
  topic: activities.topic,
  mainMedia: activities.mainMedia,
  durationMinutes: activities.durationMinutes,
  startTime: activities.startTime,
  endTime: activities.endTime,
  progress: activities.progress,
  materialsLink: activities.materialsLink,
  notes: activities.notes,
  actualStart: activities.actualStart,
  actualEnd: activities.actualEnd,
  updatedAt: sql<string>`${activities.updatedAt}::text`,
};

export interface ScheduleRow {
  id: string;
  rowNumber: number;
  week: string;
  day: string;
  date: string;
  activityCount: number | null;
  pic: string;
  topic: string;
  mainMedia: string;
  durationMinutes: number | null;
  startTime: string | null;
  endTime: string | null;
  progress: string | null;
  materialsLink: string | null;
  notes: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  updatedAt: string;
}

/** `Activity` (as the app renders it) plus the raw sheet columns an agent needs to propose edits. */
export interface AgentScheduleItem extends Activity {
  rowNumber: number;
  week: string;
  topic: string;
  mainMedia: string;
  /** Raw sheet progress: `''`, `Done`, `In Progress`, `On-Hold`, `Reschedule`. */
  progress: string;
  startTime: string | null;
  endTime: string | null;
  /** Postgres `updated_at::text` (full precision); the staleness token for proposals. */
  updatedAt: string;
}

export function toScheduleItem(row: ScheduleRow): AgentScheduleItem {
  const item: ScheduleActivity = {
    id: row.id,
    rowNumber: row.rowNumber,
    week: row.week,
    day: row.day,
    date: row.date,
    activityCount: row.activityCount ?? undefined,
    pic: row.pic,
    topic: row.topic,
    mainMedia: row.mainMedia,
    durationMinutes: row.durationMinutes ?? undefined,
    startTime: row.startTime ?? undefined,
    endTime: row.endTime ?? undefined,
    progress: row.progress || '',
    materialsLink: row.materialsLink || '',
    notes: row.notes || '',
  };
  const activity = scheduleActivityToActivity(item);
  if (row.actualStart) activity.actualStart = row.actualStart;
  if (row.actualEnd) activity.actualEnd = row.actualEnd;
  if (row.durationMinutes) activity.durationMinutes = row.durationMinutes;
  return {
    ...activity,
    rowNumber: row.rowNumber,
    week: row.week,
    topic: row.topic,
    mainMedia: row.mainMedia,
    progress: row.progress || '',
    startTime: row.startTime,
    endTime: row.endTime,
    updatedAt: row.updatedAt,
  };
}

export async function listScheduleItems(executor: AgentExecutor): Promise<AgentScheduleItem[]> {
  const rows = await executor.select(SCHEDULE_SELECTION).from(activities).orderBy(asc(activities.rowNumber));
  return rows.map(toScheduleItem);
}

export async function getScheduleItem(executor: AgentExecutor, id: string): Promise<AgentScheduleItem | null> {
  const rows = await executor.select(SCHEDULE_SELECTION).from(activities).where(eq(activities.id, id)).limit(1);
  return rows[0] ? toScheduleItem(rows[0]) : null;
}

// ---------------------------------------------------------------------------------------------
// Filters for GET /schedule?date=&week=&progress=
// ---------------------------------------------------------------------------------------------

export const SCHEDULE_PROGRESS_FILTERS = ['Done', 'In Progress', 'On-Hold', 'Reschedule', 'Not Started'] as const;
export type ScheduleProgressFilter = (typeof SCHEDULE_PROGRESS_FILTERS)[number];

export interface ScheduleFilter {
  date?: { y: number; m: number; d: number };
  week?: string;
  progress?: ScheduleProgressFilter;
}

export const SCHEDULE_QUERY_KEYS = ['date', 'week', 'progress'] as const;

export function parseScheduleFilter(query: Partial<Record<(typeof SCHEDULE_QUERY_KEYS)[number], string>>): Parsed<ScheduleFilter> {
  const filter: ScheduleFilter = {};
  if (query.date !== undefined) {
    const date = parseIsoDate(query.date);
    if (!date) return { ok: false, response: badQuery('date must be a calendar date in YYYY-MM-DD format.') };
    filter.date = date;
  }
  if (query.week !== undefined) {
    const week = query.week.trim();
    if (!week || week.length > 64) return { ok: false, response: badQuery('week must be 1-64 characters, e.g. "Week 1".') };
    filter.week = week;
  }
  if (query.progress !== undefined) {
    const progress = SCHEDULE_PROGRESS_FILTERS.find((p) => p === query.progress);
    if (!progress) {
      return { ok: false, response: badQuery(`progress must be one of: ${SCHEDULE_PROGRESS_FILTERS.join(', ')}.`) };
    }
    filter.progress = progress;
  }
  return { ok: true, value: filter };
}

export function matchesScheduleFilter(item: AgentScheduleItem, filter: ScheduleFilter): boolean {
  if (filter.date) {
    const date = parseSheetDate(item.date);
    if (!date || date.y !== filter.date.y || date.m !== filter.date.m || date.d !== filter.date.d) return false;
  }
  if (filter.week && item.week.trim().toLowerCase() !== filter.week.toLowerCase()) return false;
  if (filter.progress) {
    if (filter.progress === 'Not Started') {
      if (item.progress !== '' && item.progress !== 'Not Started') return false;
    } else if (item.progress !== filter.progress) {
      return false;
    }
  }
  return true;
}
