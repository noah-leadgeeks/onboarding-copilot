import {
  DEFAULT_SCHEDULE_FILTERS,
  HIDE_COMPLETED_STORAGE_KEY,
  activeFilterCount,
  activityIdFromHash,
  completedRowSummary,
  filterScheduleActivities,
  filtersRevealing,
  groupScheduleByWeek,
  hasReflectionFor,
  matchesScheduleFilters,
  nextUpActivity,
  readHideCompleted,
  splitCompletedRuns,
  reflectedActivityIds,
  SCHEDULE_WEEK_TABS,
  scheduleCardPrimaryAction,
  scheduleRowToolLabels,
  weekGroupHeading,
  writeHideCompleted,
} from './schedule-view';
import { OFFICIAL_SCHEDULE_ACTIVITIES, type ScheduleActivity } from './schedule-catalog';

function activity(overrides: Partial<ScheduleActivity> & Pick<ScheduleActivity, 'id' | 'rowNumber'>): ScheduleActivity {
  return {
    week: 'Week 1',
    day: 'Tuesday',
    date: '01/09/2026',
    pic: 'HRD',
    topic: 'Topic',
    mainMedia: 'Online Meeting',
    progress: '',
    ...overrides,
  };
}

describe('groupScheduleByWeek', () => {
  it('orders Week 1…5 then the monthly reviews and counts done items', () => {
    const items = [
      activity({ id: 'm2', rowNumber: 81, week: 'Month 2 Review' }),
      activity({ id: 'w2', rowNumber: 25, week: 'Week 2', progress: 'Done' }),
      activity({ id: 'w1a', rowNumber: 3, week: 'Week 1', progress: 'Done' }),
      activity({ id: 'm1', rowNumber: 58, week: 'Month 1 Review', progress: 'Done' }),
      activity({ id: 'w1b', rowNumber: 4, week: 'Week 1' }),
      activity({ id: 'w10', rowNumber: 70, week: 'Week 10' }),
    ];
    const groups = groupScheduleByWeek(items);
    expect(groups.map((g) => g.key)).toEqual(['Week 1', 'Week 2', 'Week 10', 'Month 1 Review', 'Month 2 Review']);
    expect([groups[0].title, groups[0].doneCount]).toEqual(['Week 1', 1]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['w1a', 'w1b']);
  });

  it('covers the whole official catalog: 21/10/7/8/4/2/11/7/11/11 weeks then three reviews', () => {
    const groups = groupScheduleByWeek(OFFICIAL_SCHEDULE_ACTIVITIES);
    expect(groups.map((g) => `${g.key}:${g.items.length}`)).toEqual([
      'Week 1:21',
      'Week 2:10',
      'Week 3:7',
      'Week 4:8',
      'Week 5:4',
      'Week 6:2',
      'Week 7:11',
      'Week 8:7',
      'Week 9:11',
      'Week 10:11',
      'Month 1 Review:1',
      'Month 2 Review:1',
      'Month 3 Review:1',
    ]);
    expect(groups.reduce((sum, g) => sum + g.doneCount, 0)).toBe(93);
  });

  it('splits finished activities into compact runs between open cards', () => {
    const items = [
      activity({ id: 'a', rowNumber: 3, progress: 'Done' }),
      activity({ id: 'b', rowNumber: 4, progress: 'Done' }),
      activity({ id: 'c', rowNumber: 5, progress: 'In Progress' }),
      activity({ id: 'd', rowNumber: 6, progress: 'Done' }),
    ];
    const runs = splitCompletedRuns(items).map((run) =>
      run.kind === 'done' ? `done:${run.items.map((i) => i.id).join('')}` : `open:${run.item.id}`
    );
    expect(runs).toEqual(['done:ab', 'open:c', 'done:d']);
    expect(splitCompletedRuns([])).toEqual([]);
  });

  it('formats the sticky heading', () => {
    expect(weekGroupHeading('Week 1', 20, 21)).toBe('Week 1 · 20 of 21 done');
  });
});

describe('nextUpActivity', () => {
  const items = [
    activity({ id: 'a', rowNumber: 3, date: '01/09/2026', progress: 'Done' }),
    activity({ id: 'b', rowNumber: 4, date: '02/09/2026' }),
    activity({ id: 'c', rowNumber: 5, date: '10/09/2026' }),
  ];

  it('returns the first not-done item dated today or later in Jakarta', () => {
    expect(nextUpActivity(items, new Date('2026-09-05T03:00:00Z'))?.id).toBe('c');
    // 00:30 on 2 Sep in Jakarta is still 1 Sep in UTC.
    expect(nextUpActivity(items, new Date('2026-09-01T17:30:00Z'))?.id).toBe('b');
  });

  it('falls back to the first not-done item, and null when all are done', () => {
    expect(nextUpActivity(items, new Date('2026-12-01T03:00:00Z'))?.id).toBe('b');
    expect(nextUpActivity([items[0]], new Date('2026-09-01T03:00:00Z'))).toBeNull();
  });

  it('finds the two open monthly reviews in the official catalog', () => {
    const next = nextUpActivity(OFFICIAL_SCHEDULE_ACTIVITIES, new Date('2026-09-01T03:00:00Z'));
    expect(next?.progress).not.toBe('Done');
  });
});

describe('schedule filters', () => {
  const now = new Date('2026-09-01T03:00:00Z');
  const items = [
    activity({ id: 'a', rowNumber: 3, week: 'Week 1', day: 'Tuesday', progress: 'Done', topic: 'Company intro' }),
    activity({ id: 'b', rowNumber: 26, week: 'Week 2', day: 'Monday', date: '07/09/2026', progress: '', topic: 'IT functions', pic: 'IT Manager' }),
    activity({ id: 'c', rowNumber: 58, week: 'Month 1 Review', day: 'Friday', date: '02/10/2026', progress: 'In Progress' }),
  ];

  it('applies week, day, status, search and hide completed together', () => {
    const ids = (f: Partial<typeof DEFAULT_SCHEDULE_FILTERS>) =>
      filterScheduleActivities(items, { ...DEFAULT_SCHEDULE_FILTERS, ...f }, now).map((i) => i.id);
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ week: 'Today' })).toEqual(['a']);
    expect(ids({ week: 'Monthly Reviews' })).toEqual(['c']);
    expect(ids({ week: 'Week 2' })).toEqual(['b']);
    expect(ids({ day: 'Monday' })).toEqual(['b']);
    expect(ids({ status: 'Not Started' })).toEqual(['b']);
    expect(ids({ status: 'In Progress' })).toEqual(['c']);
    expect(ids({ hideCompleted: true })).toEqual(['b', 'c']);
    expect(ids({ search: 'it manager' })).toEqual(['b']);
    expect(ids({ search: '26' })).toEqual(['b']);
  });

  it('filtersRevealing keeps filters that already show the item, otherwise resets them', () => {
    const hiding = { ...DEFAULT_SCHEDULE_FILTERS, week: 'Week 2', hideCompleted: true, search: 'x' };
    const revealed = filtersRevealing(items[0], hiding, now);
    expect(revealed).toEqual(DEFAULT_SCHEDULE_FILTERS);
    expect(matchesScheduleFilters(items[0], revealed, now)).toBe(true);

    const showing = { ...DEFAULT_SCHEDULE_FILTERS, week: 'Week 2' };
    expect(filtersRevealing(items[1], showing, now)).toBe(showing);
  });

  it('counts the filters behind the mobile disclosure', () => {
    expect(activeFilterCount(DEFAULT_SCHEDULE_FILTERS)).toBe(0);
    expect(activeFilterCount({ day: 'Monday', status: 'Done', hideCompleted: true })).toBe(3);
  });

  it('includes Week 1 through Week 10 in SCHEDULE_WEEK_TABS', () => {
    expect(SCHEDULE_WEEK_TABS).toContain('Week 6');
    expect(SCHEDULE_WEEK_TABS).toContain('Week 7');
    expect(SCHEDULE_WEEK_TABS).toContain('Week 8');
    expect(SCHEDULE_WEEK_TABS).toContain('Week 9');
    expect(SCHEDULE_WEEK_TABS).toContain('Week 10');
  });

  it('reads activity ids from the URL hash', () => {
    expect(activityIdFromHash('#activity-sched-row-26')).toBe('sched-row-26');
    expect(activityIdFromHash('activity-a%20b')).toBe('a b');
    expect(activityIdFromHash('#main-content')).toBeNull();
    expect(activityIdFromHash('')).toBeNull();
  });
});

describe('hide completed preference', () => {
  it('only accepts the exact strings true/false', () => {
    expect(readHideCompleted('true')).toBe(true);
    expect(readHideCompleted('false')).toBe(false);
    expect(readHideCompleted(null)).toBeNull();
    expect(readHideCompleted('TRUE')).toBeNull();
    expect(readHideCompleted('1')).toBeNull();
  });

  it('round-trips through storage', () => {
    const store = new Map<string, string>();
    const storage = {
      setItem: (k: string, v: string) => void store.set(k, v),
      getItem: (k: string) => store.get(k) ?? null,
    };
    expect(writeHideCompleted(storage, true)).toBe(true);
    expect(store.get(HIDE_COMPLETED_STORAGE_KEY)).toBe('true');
    expect(readHideCompleted(storage.getItem(HIDE_COMPLETED_STORAGE_KEY))).toBe(true);
    writeHideCompleted(storage, false);
    expect(readHideCompleted(storage.getItem(HIDE_COMPLETED_STORAGE_KEY))).toBe(false);
    expect(HIDE_COMPLETED_STORAGE_KEY).toBe('nova-schedule-hide-completed');
  });

  it('never throws when storage is missing or blocked', () => {
    expect(writeHideCompleted(null, true)).toBe(false);
    const blocked = {
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    expect(writeHideCompleted(blocked, true)).toBe(false);
  });
});

describe('reflections', () => {
  const diary = [{ activityId: 'a' }, {}, { activityId: 'c' }];

  it('hasReflectionFor matches linked diary entries only', () => {
    expect(hasReflectionFor('a', diary)).toBe(true);
    expect(hasReflectionFor('b', diary)).toBe(false);
    expect(hasReflectionFor('a', [])).toBe(false);
  });

  it('reflectedActivityIds collects the linked ids', () => {
    expect(Array.from(reflectedActivityIds(diary)).sort()).toEqual(['a', 'c']);
  });
});

describe('schedule card helpers', () => {
  it('offers Write Reflection only for done activities without one', () => {
    const base = { isTimerRunning: false, isTimerPaused: false, hasReflection: false };
    expect(scheduleCardPrimaryAction({ ...base, progress: 'Not Started' })).toBe('start');
    expect(scheduleCardPrimaryAction({ ...base, progress: 'In Progress', isTimerRunning: true })).toBe('running');
    expect(scheduleCardPrimaryAction({ ...base, progress: 'In Progress', isTimerPaused: true })).toBe('paused');
    expect(scheduleCardPrimaryAction({ ...base, progress: 'Done' })).toBe('reflection');
    expect(scheduleCardPrimaryAction({ ...base, progress: 'Done', hasReflection: true })).toBe('none');
  });

  it('keeps spreadsheet detail in the menu hints', () => {
    const labels = scheduleRowToolLabels(26);
    expect(labels.copyRow).toEqual({ label: 'Copy row (G–L)', hint: 'Paste at G26' });
    expect(labels.copyFull).toEqual({ label: 'Copy full row (A–L)', hint: 'Paste at A26' });
    expect(labels.sync.label).toBe('Sync this row');
    expect(labels.outline.label).toBe('Full outline');
  });

  it('summarises a completed row in one line', () => {
    const item = activity({ id: 'a', rowNumber: 3, topic: 'Company intro\n- History', durationMinutes: 55 });
    expect(completedRowSummary(item, false)).toEqual({
      title: 'Company intro',
      dateLabel: 'Tue 1 Sep 2026',
      duration: '55 min',
      needsReflection: true,
    });
    const plain = completedRowSummary({ ...item, durationMinutes: undefined }, true);
    expect([plain.duration, plain.needsReflection]).toEqual(['', false]);
  });
});
