import {
  buildDiarySyncBody,
  buildScheduleSyncBody,
  DIARY_SCOPE_MAX_ROW,
  diaryBulkSyncPlan,
  diaryScopeSummaries,
  effectiveSyncSource,
  scheduleBulkSyncPlan,
  scheduleChunkClipboard,
  scheduleRowHasData,
} from './bulk-sync';
import { calculateDiaryCockpitProgress, OFFICIAL_DIARY_TOPICS, type DiaryEntryRecord, type DiaryTopicItem } from './diary-cockpit';
import { clipboardRowForScheduleGtoL, OFFICIAL_SCHEDULE_ACTIVITIES, type ScheduleActivity } from './schedule-catalog';

const entry = (rowNumber: number, learned: string, notes: string): DiaryEntryRecord => ({
  rowNumber,
  learned,
  notes,
  updatedAt: '2026-09-01T00:00:00.000Z',
});

const topic = (rowNumber: number, defaults: Partial<DiaryTopicItem> = {}): DiaryTopicItem => ({
  id: `row-${rowNumber}`,
  rowNumber,
  day: 'Tuesday',
  week: 'Week 1',
  date: '01/09/2026',
  pic: 'IT',
  topic: `Topic ${rowNumber}\nsecond line`,
  ...defaults,
});

describe('diaryBulkSyncPlan', () => {
  const topics = [
    topic(2, { defaultLearned: 'a', defaultNotes: 'b' }),
    topic(3, { defaultLearned: 'a', defaultNotes: 'b' }),
    topic(4),
  ];

  it('lists a single empty row as blocking', () => {
    const plan = diaryBulkSyncPlan([entry(4, 'learned', '')], topics, 4);
    expect(plan.emptyRows).toEqual([4]);
    expect(plan.rows).toEqual([
      { rowNumber: 2, label: 'Topic 2', ready: true },
      { rowNumber: 3, label: 'Topic 3', ready: true },
      { rowNumber: 4, label: 'Topic 4', ready: false },
    ]);
    expect({ range: plan.range, count: plan.count, readyCount: plan.readyCount, maxRow: plan.maxRow, aligned: plan.aligned }).toEqual({
      range: 'G2:H4', count: 3, readyCount: 2, maxRow: 4, aligned: true,
    });
  });

  it('uses the whole saved entry: clearing notes on a topic with default notes blocks the row', () => {
    const plan = diaryBulkSyncPlan([entry(2, 'learned', '   ')], topics, 3);
    expect(plan.emptyRows).toEqual([2]);
    expect(plan.rows[0].ready).toBe(false);
  });

  it('matches the page progress on the official topics (15 blocking rows with no local entries)', () => {
    const plan = diaryBulkSyncPlan([], OFFICIAL_DIARY_TOPICS, DIARY_SCOPE_MAX_ROW.official);
    expect(plan.count).toBe(24);
    expect(plan.range).toBe('G2:H25');
    expect(plan.aligned).toBe(true);
    expect(plan.emptyRows).toHaveLength(15);
    const official = OFFICIAL_DIARY_TOPICS.filter((t) => t.rowNumber <= 25);
    expect(plan.readyCount).toBe(calculateDiaryCockpitProgress([], official).completedCount);
    expect(diaryBulkSyncPlan([], OFFICIAL_DIARY_TOPICS, DIARY_SCOPE_MAX_ROW.all).count).toBe(28);
  });

  it('flags gaps the route would refuse', () => {
    expect(diaryBulkSyncPlan([], [topic(2), topic(4)], 4).aligned).toBe(false);
  });
});

describe('diaryScopeSummaries', () => {
  it('states each scope with its real count on the official topics', () => {
    const summaries = diaryScopeSummaries(OFFICIAL_DIARY_TOPICS);
    expect(summaries.official).toEqual({
      scope: 'official', maxRow: 25, count: 24, label: 'Official range: 24 topics, rows 2–25',
    });
    expect(summaries.all).toEqual({ scope: 'all', maxRow: 29, count: 28, label: 'All topics: 28, rows 2–29' });
  });

  it('counts only the topics inside each range', () => {
    const summaries = diaryScopeSummaries([topic(2), topic(25), topic(26)]);
    expect(summaries.official.count).toBe(2);
    expect(summaries.all.count).toBe(3);
  });
});

const activity = (rowNumber: number, extra: Partial<ScheduleActivity> = {}): ScheduleActivity => ({
  id: `sched-row-${rowNumber}`,
  rowNumber,
  week: 'Week 1',
  day: 'Tuesday',
  date: '01/09/2026',
  pic: 'IT',
  topic: `Topic ${rowNumber}`,
  mainMedia: 'Meeting',
  progress: '',
  ...extra,
});

describe('scheduleRowHasData', () => {
  it('treats any G–L value (including 0 minutes) as data', () => {
    expect(scheduleRowHasData(activity(3))).toBe(false);
    expect(scheduleRowHasData(activity(3, { progress: 'Not Started' as ScheduleActivity['progress'] }))).toBe(false);
    expect(scheduleRowHasData(activity(3, { durationMinutes: 0 }))).toBe(true);
    expect(scheduleRowHasData(activity(3, { notes: 'x' }))).toBe(true);
    expect(scheduleRowHasData(activity(3, { progress: 'Done' }))).toBe(true);
  });
});

describe('scheduleBulkSyncPlan', () => {
  it('on the real catalog writes 93 rows and leaves rows 102 and 106 unchanged', () => {
    const plan = scheduleBulkSyncPlan(OFFICIAL_SCHEDULE_ACTIVITIES);
    expect(OFFICIAL_SCHEDULE_ACTIVITIES).toHaveLength(95);
    expect(plan.rowsWithData).toHaveLength(93);
    expect(plan.skipped.map((a) => a.rowNumber)).toEqual([102, 106]);
    expect(plan.rowsWithData.some((a) => a.rowNumber === 102 || a.rowNumber === 106)).toBe(false);
    expect(plan.ranges).toEqual(['G3:L23', 'G25:L34', 'G36:L42', 'G44:L51', 'G53:L56', 'G58:L100']);
    expect(plan.rowSummary).toBe('3–23, 25–34, 36–42, 44–51, 53–56, 58–100');
    expect(plan.chunks.reduce((sum, chunk) => sum + chunk.rowCount, 0)).toBe(93);
  });

  it('with data on every catalog row covers every block including 102 and 106', () => {
    const filled = OFFICIAL_SCHEDULE_ACTIVITIES.map((a) => ({ ...a, notes: a.notes || 'x' }));
    const plan = scheduleBulkSyncPlan(filled);
    expect(plan.skipped).toEqual([]);
    expect(plan.ranges).toEqual(['G3:L23', 'G25:L34', 'G36:L42', 'G44:L51', 'G53:L56', 'G58:L100', 'G102:L102', 'G106:L106']);
  });

  it('excludes data-less rows from the written list', () => {
    const plan = scheduleBulkSyncPlan([activity(5, { notes: 'x' }), activity(4), activity(3, { progress: 'Done' })]);
    expect(plan.rowsWithData.map((a) => a.rowNumber)).toEqual([3, 5]);
    expect(plan.skipped.map((a) => a.rowNumber)).toEqual([4]);
    expect(plan.ranges).toEqual(['G3:L3', 'G5:L5']);
  });
});

describe('scheduleChunkClipboard', () => {
  it('produces one line per chunk row, identical to the per-row builder', () => {
    const plan = scheduleBulkSyncPlan(OFFICIAL_SCHEDULE_ACTIVITIES);
    for (const chunk of plan.chunks) {
      const text = scheduleChunkClipboard(chunk);
      expect(text.split('\n')).toHaveLength(chunk.rowCount);
      const rows = plan.rowsWithData.filter((a) => a.rowNumber >= chunk.startRow && a.rowNumber <= chunk.endRow);
      expect(text).toBe(rows.map(clipboardRowForScheduleGtoL).join('\n'));
    }
  });

  it('escapes tabs, quotes and newlines like the per-row builder', () => {
    const tricky = activity(3, { notes: 'line 1\nline "2"\tend', durationMinutes: 30 });
    const [chunk] = scheduleBulkSyncPlan([tricky]).chunks;
    expect(scheduleChunkClipboard(chunk)).toBe(clipboardRowForScheduleGtoL(tricky));
  });
});

describe('buildScheduleSyncBody', () => {
  it('sends exactly week All and the planned rows', () => {
    const plan = scheduleBulkSyncPlan(OFFICIAL_SCHEDULE_ACTIVITIES);
    const body = buildScheduleSyncBody(plan, 'database');
    expect(Object.keys(body).sort()).toEqual(['activities', 'week']);
    expect(body.week).toBe('All');
    expect(body.activities).toBe(plan.rowsWithData);
    expect(Object.keys(body)).not.toContain('spreadsheetId');
  });

  it('refuses an empty list (the route would fall back to every row)', () => {
    expect(() => buildScheduleSyncBody(scheduleBulkSyncPlan([activity(3)]), 'catalog')).toThrow();
    expect(() => buildScheduleSyncBody(scheduleBulkSyncPlan([]), 'catalog')).toThrow();
  });

  it('refuses while the data is loading', () => {
    expect(() => buildScheduleSyncBody(scheduleBulkSyncPlan(OFFICIAL_SCHEDULE_ACTIVITIES), 'loading')).toThrow();
  });
});

describe('buildDiarySyncBody', () => {
  it('keeps the { scope, maxRow, entries } shape and drops rows past maxRow', () => {
    const entries = [entry(2, 'a', 'b'), entry(25, 'a', 'b'), entry(27, 'a', 'b')];
    const body = buildDiarySyncBody('official', 25, entries, 'local');
    expect(Object.keys(body)).toEqual(['scope', 'maxRow', 'entries']);
    expect(body).toEqual({ scope: 'official', maxRow: 25, entries: [entries[0], entries[1]] });
    expect(Object.keys(body)).not.toContain('spreadsheetId');
    expect(buildDiarySyncBody('all', 29, entries, 'database').entries).toHaveLength(3);
  });

  it('refuses while the data is loading', () => {
    expect(() => buildDiarySyncBody('official', 25, [], 'loading')).toThrow();
  });
});

describe('effectiveSyncSource', () => {
  it('stays loading until the remote load has settled, even with local entries', () => {
    expect(effectiveSyncSource(false, 'local')).toBe('loading');
    expect(effectiveSyncSource(false, 'database')).toBe('loading');
    expect(effectiveSyncSource(false, 'loading')).toBe('loading');
  });

  it('passes the source through once settled', () => {
    expect(effectiveSyncSource(true, 'local')).toBe('local');
    expect(effectiveSyncSource(true, 'database')).toBe('database');
    expect(effectiveSyncSource(true, 'loading')).toBe('loading');
  });

  it('makes buildDiarySyncBody throw for the unsettled case and not once settled', () => {
    const entries = [entry(2, 'stale', 'stale')];
    expect(() => buildDiarySyncBody('official', 25, entries, effectiveSyncSource(false, 'local'))).toThrow();
    expect(buildDiarySyncBody('official', 25, entries, effectiveSyncSource(true, 'local')).entries).toHaveLength(1);
  });
});
