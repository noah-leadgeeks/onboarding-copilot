/**
 * Pure view helpers for the Schedule page (grouping, next-up, filters, the
 * "Hide completed" preference) and the schedule card / completed row.
 * Display only: nothing here builds a request body or clipboard text.
 */
import type { ScheduleActivity } from './schedule-catalog';
import { isSameJakartaDate } from './format-date';
import { activityDateLabel, nextUpcomingActivity, topicTitle } from './today-view';

export function isScheduleActivityDone(item: Pick<ScheduleActivity, 'progress'>): boolean {
  return item.progress === 'Done';
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export interface ScheduleWeekGroup<T extends Pick<ScheduleActivity, 'week' | 'progress'> = ScheduleActivity> {
  key: string;
  title: string;
  items: T[];
  doneCount: number;
}

/** Sort rank: Week 1…N first, then Month 1…N reviews, then anything else (alphabetical). */
function weekRank(week: string): [number, number, string] {
  const weekMatch = /^Week\s+(\d+)/i.exec(week);
  if (weekMatch) return [0, Number(weekMatch[1]), week];
  const monthMatch = /^Month\s+(\d+)/i.exec(week);
  if (monthMatch) return [1, Number(monthMatch[1]), week];
  return [2, 0, week];
}

function compareWeeks(a: string, b: string): number {
  const [ga, na, sa] = weekRank(a);
  const [gb, nb, sb] = weekRank(b);
  if (ga !== gb) return ga - gb;
  if (na !== nb) return na - nb;
  return sa.localeCompare(sb);
}

/** Groups items by their `week` (Week 1…5, then Month reviews), keeping each group's item order. */
export function groupScheduleByWeek<T extends Pick<ScheduleActivity, 'week' | 'progress'>>(
  items: readonly T[]
): ScheduleWeekGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = (item.week || '').trim() || 'Other';
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return Array.from(groups.keys())
    .sort(compareWeeks)
    .map((key) => {
      const groupItems = groups.get(key) ?? [];
      return {
        key,
        title: key,
        items: groupItems,
        doneCount: groupItems.filter(isScheduleActivityDone).length,
      };
    });
}

export type ScheduleListRun<T> = { kind: 'done'; items: T[] } | { kind: 'open'; item: T };

/**
 * Splits a week's items (in order) into runs: consecutive finished activities
 * become one compact list, every other activity stays a full card.
 */
export function splitCompletedRuns<T extends Pick<ScheduleActivity, 'progress'>>(items: readonly T[]): ScheduleListRun<T>[] {
  const runs: ScheduleListRun<T>[] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (!isScheduleActivityDone(item)) runs.push({ kind: 'open', item });
    else if (last && last.kind === 'done') last.items.push(item);
    else runs.push({ kind: 'done', items: [item] });
  }
  return runs;
}

/** "Week 1 · 20 of 21 done". */
export function weekGroupHeading(title: string, doneCount: number, total: number): string {
  return `${title} · ${doneCount} of ${total} done`;
}

/** The activity to work on next: first not-done item dated today or later (Jakarta), else the first not-done. */
export function nextUpActivity<T extends Pick<ScheduleActivity, 'date' | 'progress'>>(
  items: readonly T[],
  now: Date
): T | null {
  return nextUpcomingActivity(items, now, isScheduleActivityDone);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const SCHEDULE_WEEK_TABS = [
  'All',
  'Today',
  'Week 1',
  'Week 2',
  'Week 3',
  'Week 4',
  'Week 5',
  'Week 6',
  'Week 7',
  'Week 8',
  'Week 9',
  'Week 10',
  'Monthly Reviews',
] as const;

export interface ScheduleFilters {
  week: string;
  day: string;
  status: string;
  search: string;
  hideCompleted: boolean;
}

export const DEFAULT_SCHEDULE_FILTERS: ScheduleFilters = {
  week: 'All',
  day: 'All',
  status: 'All',
  search: '',
  hideCompleted: false,
};

export function matchesWeekTab(item: Pick<ScheduleActivity, 'week' | 'date'>, week: string, now: Date): boolean {
  if (week === 'All') return true;
  if (week === 'Today') return isSameJakartaDate(item.date, now);
  if (week === 'Monthly Reviews') return item.week.startsWith('Month');
  return item.week === week;
}

function matchesStatus(progress: string | undefined, status: string): boolean {
  if (status === 'All') return true;
  if (status === 'Not Started') return progress === 'Not Started' || progress === '' || progress === undefined;
  return progress === status;
}

function matchesSearch(item: ScheduleActivity, search: string): boolean {
  const q = search.toLowerCase().trim();
  if (!q) return true;
  return (
    item.topic.toLowerCase().includes(q) ||
    item.pic.toLowerCase().includes(q) ||
    item.mainMedia.toLowerCase().includes(q) ||
    `row ${item.rowNumber}`.includes(q) ||
    String(item.rowNumber) === q
  );
}

/** Whether the item passes every filter (week tab, day, status, search, hide completed). */
export function matchesScheduleFilters(item: ScheduleActivity, filters: ScheduleFilters, now: Date): boolean {
  if (!matchesWeekTab(item, filters.week, now)) return false;
  if (filters.day !== 'All' && item.day !== filters.day) return false;
  if (!matchesStatus(item.progress, filters.status)) return false;
  if (filters.hideCompleted && isScheduleActivityDone(item)) return false;
  return matchesSearch(item, filters.search);
}

export function filterScheduleActivities(
  items: readonly ScheduleActivity[],
  filters: ScheduleFilters,
  now: Date
): ScheduleActivity[] {
  return items.filter((item) => matchesScheduleFilters(item, filters, now));
}

/**
 * Filters that let a linked activity (#activity-{id}) show: unchanged when it
 * already passes, otherwise everything reset to defaults.
 */
export function filtersRevealing(item: ScheduleActivity, filters: ScheduleFilters, now: Date): ScheduleFilters {
  return matchesScheduleFilters(item, filters, now) ? filters : { ...DEFAULT_SCHEDULE_FILTERS };
}

/** Count of the filters tucked behind the mobile "Filters" disclosure (day, progress, hide completed). */
export function activeFilterCount(filters: Pick<ScheduleFilters, 'day' | 'status' | 'hideCompleted'>): number {
  return (filters.day !== 'All' ? 1 : 0) + (filters.status !== 'All' ? 1 : 0) + (filters.hideCompleted ? 1 : 0);
}

/** `#activity-sched-row-26` → `sched-row-26`; null for any other hash. */
export function activityIdFromHash(hash: string | null | undefined): string | null {
  const match = /^#?activity-(.+)$/.exec(hash ?? '');
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function activityAnchorId(id: string): string {
  return `activity-${id}`;
}

// ---------------------------------------------------------------------------
// "Hide completed" preference
// ---------------------------------------------------------------------------

export const HIDE_COMPLETED_STORAGE_KEY = 'nova-schedule-hide-completed';

/** Only the exact strings 'true' / 'false' count; anything else means "not set". */
export function readHideCompleted(raw: string | null | undefined): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

/** Persists the preference; never throws (private mode, blocked storage). */
export function writeHideCompleted(storage: Pick<Storage, 'setItem'> | null | undefined, value: boolean): boolean {
  try {
    if (!storage) return false;
    storage.setItem(HIDE_COMPLETED_STORAGE_KEY, value ? 'true' : 'false');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reflections
// ---------------------------------------------------------------------------

/** True when a saved diary entry is linked to this activity. */
export function hasReflectionFor(activityId: string, diary: readonly { activityId?: string }[]): boolean {
  return diary.some((entry) => entry.activityId === activityId);
}

/** Ids of activities that already have a linked diary reflection. */
export function reflectedActivityIds(diary: readonly { activityId?: string }[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of diary) if (entry.activityId) ids.add(entry.activityId);
  return ids;
}

// ---------------------------------------------------------------------------
// Schedule card / completed row
// ---------------------------------------------------------------------------

export type ScheduleCardPrimaryAction = 'start' | 'running' | 'paused' | 'reflection' | 'none';

/** Primary action on a schedule card; done activities only offer a reflection when none is saved yet. */
export function scheduleCardPrimaryAction(params: {
  progress: string | undefined;
  isTimerRunning: boolean;
  isTimerPaused: boolean;
  hasReflection: boolean;
}): ScheduleCardPrimaryAction {
  if (params.progress === 'Done') return params.hasReflection ? 'none' : 'reflection';
  if (params.isTimerRunning) return 'running';
  if (params.isTimerPaused) return 'paused';
  return 'start';
}

export interface ScheduleRowToolLabels {
  sync: { label: string; hint: string };
  copyRow: { label: string; hint: string };
  copyFull: { label: string; hint: string };
  outline: { label: string; hint?: string };
}

/** Sheet tools menu copy for one schedule row (spreadsheet detail only in hints). */
export function scheduleRowToolLabels(rowNumber: number): ScheduleRowToolLabels {
  return {
    sync: { label: 'Sync this row', hint: `Writes G–L of row ${rowNumber} in the Schedule sheet` },
    copyRow: { label: 'Copy row (G–L)', hint: `Paste at G${rowNumber}` },
    copyFull: { label: 'Copy full row (A–L)', hint: `Paste at A${rowNumber}` },
    outline: { label: 'Full outline' },
  };
}

export interface CompletedRowSummary {
  title: string;
  dateLabel: string;
  /** "55 min" or '' when no duration was logged. */
  duration: string;
  needsReflection: boolean;
}

/** What a one-line completed activity shows. */
export function completedRowSummary(
  item: Pick<ScheduleActivity, 'topic' | 'day' | 'date' | 'durationMinutes'>,
  hasReflection: boolean
): CompletedRowSummary {
  const title = topicTitle(item.topic);
  const dateLabel = activityDateLabel(item.day, item.date);
  const duration =
    typeof item.durationMinutes === 'number' && Number.isFinite(item.durationMinutes) ? `${item.durationMinutes} min` : '';
  return { title, dateLabel, duration, needsReflection: !hasReflection };
}
