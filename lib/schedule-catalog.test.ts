import {
  OFFICIAL_SCHEDULE_ACTIVITIES,
  calculateDurationFromTimes,
  clipboardRowForScheduleGtoK,
  clipboardRowForScheduleFull,
  groupScheduleActivitiesIntoChunks,
  clipboardAllScheduleGtoL,
  readScheduleCustomizations,
  writeScheduleCustomizations,
  getProgressBadge,
  isSameDate,
  getTodayScheduleActivities,
  type ScheduleActivity,
} from './schedule-catalog';

describe('Official Schedule Catalog', () => {
  it('contains 95 activities across Weeks 1 to 10 and Monthly Reviews', () => {
    expect(OFFICIAL_SCHEDULE_ACTIVITIES.length).toBe(95);

    const first = OFFICIAL_SCHEDULE_ACTIVITIES[0];
    expect(first.rowNumber).toBe(3);
    expect(first.topic).toBe('Introduction to Onboarding Framework');
    expect(first.durationMinutes).toBe(30);
    expect(first.startTime).toBe('08:30');
    expect(first.endTime).toBe('09:00');
    expect(first.progress).toBe('Done');

    const itWorkflow = OFFICIAL_SCHEDULE_ACTIVITIES.find((a) => a.rowNumber === 20);
    expect(itWorkflow).toBeDefined();
    expect(itWorkflow?.pic).toBe('IT Manager');
    expect(itWorkflow?.topic).toContain('How IT Works at LeadGeeks');
    expect(itWorkflow?.durationMinutes).toBe(155);
    expect(itWorkflow?.materialsLink).toContain('drive.google.com');
  });

  it('calculates duration in minutes from start and end times', () => {
    expect(calculateDurationFromTimes('09:00', '10:30')).toBe(90);
    expect(calculateDurationFromTimes('10:15', '11:00')).toBe(45);
    expect(calculateDurationFromTimes('11:00', '10:00')).toBeUndefined();
    expect(calculateDurationFromTimes('', '10:00')).toBeUndefined();
    // Midnight crossovers (late evening to early morning)
    expect(calculateDurationFromTimes('23:44', '00:34')).toBe(50);
    expect(calculateDurationFromTimes('23:00', '01:15')).toBe(135);
  });

  it('generates a 6-column TSV for Columns G–L of sheet Schedule', () => {
    const item: ScheduleActivity = {
      id: 'sched-row-20',
      rowNumber: 20,
      week: 'Week 1',
      day: 'Thursday',
      date: '03/09/2026',
      activityCount: 18,
      pic: 'IT Manager',
      topic: 'How IT Works at LeadGeeks',
      mainMedia: 'Knowledge Sharing',
      durationMinutes: 155,
      startTime: '10:00',
      endTime: '12:35',
      progress: 'Done',
      materialsLink: 'https://drive.google.com/test',
      notes: 'Review complete',
    };

    const tsv = clipboardRowForScheduleGtoK(item);
    const cols = tsv.split('\t');
    expect(cols).toHaveLength(6);
    expect(cols[0]).toBe('155'); // Col G: Duration (minutes)
    expect(cols[1]).toBe('10:00'); // Col H: Start Time
    expect(cols[2]).toBe('12:35'); // Col I: End Time
    expect(cols[3]).toBe('Done'); // Col J: Progress
    expect(cols[4]).toBe('https://drive.google.com/test'); // Col K: Link to Materials
    expect(cols[5]).toBe('Review complete'); // Col L: Notes
  });

  it('generates a 12-column TSV for Columns A–L of sheet Schedule', () => {
    const item = OFFICIAL_SCHEDULE_ACTIVITIES[0];
    const tsv = clipboardRowForScheduleFull(item);
    const cols = tsv.split('\t');
    expect(cols).toHaveLength(12);
    expect(cols[0]).toBe(item.day);
    expect(cols[4]).toBe(item.topic);
    expect(cols[6]).toBe('30');
    expect(cols[7]).toBe('08:30');
    expect(cols[8]).toBe('09:00');
    expect(cols[9]).toBe('Done');
  });

  it('reads and writes schedule customizations', () => {
    const custom = {
      'sched-row-20': {
        durationMinutes: 160,
        startTime: '10:00',
        endTime: '12:40',
        progress: 'Done',
        notes: 'Extended discussion with IT Manager',
      },
    };
    const raw = writeScheduleCustomizations(custom);
    const parsed = readScheduleCustomizations(raw);
    expect(parsed).toEqual(custom);
  });

  it('sanitizes "Not Started" to empty string in TSV exports to respect Google Sheets dropdown validation', () => {
    const item: ScheduleActivity = {
      id: 'sched-row-27',
      rowNumber: 27,
      week: 'Week 2',
      day: 'Monday',
      date: '07/09/2026',
      activityCount: 24,
      pic: 'IT Staff',
      topic: 'Personal Learning and Task',
      mainMedia: 'Independent Learning and Task',
      progress: 'Not Started',
    };

    const tsvGtoK = clipboardRowForScheduleGtoK(item);
    const colsGtoK = tsvGtoK.split('\t');
    expect(colsGtoK[3]).toBe(''); // Col J should be blank, never "Not Started"

    const tsvFull = clipboardRowForScheduleFull(item);
    const colsFull = tsvFull.split('\t');
    expect(colsFull[9]).toBe(''); // Col J should be blank
  });

  it('preserves valid Google Sheets dropdown values in TSV export', () => {
    const validStatuses = ['Done', 'In Progress', 'On-Hold', 'Reschedule'] as const;

    for (const status of validStatuses) {
      const item: ScheduleActivity = {
        id: 'sched-test',
        rowNumber: 30,
        week: 'Week 2',
        day: 'Tuesday',
        date: '08/09/2026',
        activityCount: 25,
        pic: 'IT Staff',
        topic: 'Test topic',
        mainMedia: 'Video',
        progress: status,
      };

      const tsvGtoK = clipboardRowForScheduleGtoK(item);
      expect(tsvGtoK.split('\t')[3]).toBe(status);

      const tsvFull = clipboardRowForScheduleFull(item);
      expect(tsvFull.split('\t')[9]).toBe(status);
    }
  });

  it('returns correct CSS classes for getProgressBadge', () => {
    expect(getProgressBadge('done')).toContain('mint');
    expect(getProgressBadge('in progress')).toContain('peach');
    expect(getProgressBadge('on-hold')).toContain('amber');
    expect(getProgressBadge('reschedule')).toContain('sky');
    expect(getProgressBadge(undefined)).toContain('stone');
    expect(getProgressBadge('')).toContain('stone');
    expect(getProgressBadge('Not Started')).toContain('stone');
  });

  describe('isSameDate and getTodayScheduleActivities', () => {
    const targetDate = new Date(2026, 8, 8); // Tuesday, September 8, 2026

    it('correctly matches DD/MM/YYYY dates', () => {
      expect(isSameDate('08/09/2026', targetDate)).toBe(true);
      expect(isSameDate('07/09/2026', targetDate)).toBe(false);
      expect(isSameDate('09/09/2026', targetDate)).toBe(false);
    });

    it('correctly matches YYYY-MM-DD ISO dates', () => {
      expect(isSameDate('2026-09-08', targetDate)).toBe(true);
      expect(isSameDate('2026-09-07', targetDate)).toBe(false);
    });

    it('handles single digit days and months', () => {
      expect(isSameDate('8/9/2026', targetDate)).toBe(true);
      expect(isSameDate('2026-9-8', targetDate)).toBe(true);
    });

    it('returns false for empty or invalid dates', () => {
      expect(isSameDate(undefined, targetDate)).toBe(false);
      expect(isSameDate('', targetDate)).toBe(false);
      expect(isSameDate('TBD', targetDate)).toBe(false);
    });

    it('retrieves only the 2 tasks for Tuesday 08/09/2026 from official schedule catalog', () => {
      const todayTasks = getTodayScheduleActivities(OFFICIAL_SCHEDULE_ACTIVITIES, targetDate);
      expect(todayTasks).toHaveLength(2);
      expect(todayTasks[0].activityCount).toBe(24);
      expect(todayTasks[0].rowNumber).toBe(27);
      expect(todayTasks[0].day).toBe('Tuesday');
      expect(todayTasks[0].date).toBe('08/09/2026');
      expect(todayTasks[0].topic).toContain('Infrastructure Management at LeadGeeks');

      expect(todayTasks[1].activityCount).toBe(25);
      expect(todayTasks[1].rowNumber).toBe(28);
      expect(todayTasks[1].day).toBe('Tuesday');
      expect(todayTasks[1].date).toBe('08/09/2026');
      expect(todayTasks[1].topic).toContain('Independent Learning and Task');
    });

    it('does NOT include Monday activities in today tasks on Tuesday', () => {
      const todayTasks = getTodayScheduleActivities(OFFICIAL_SCHEDULE_ACTIVITIES, targetDate);
      expect(todayTasks.some((t) => t.day === 'Monday')).toBe(false);
      expect(todayTasks.every((t) => t.day === 'Tuesday')).toBe(true);
    });
  });

  describe('groupScheduleActivitiesIntoChunks and clipboardAllScheduleGtoL', () => {
    it('groups 53 activities into 8 contiguous range chunks skipping title rows', () => {
      const chunks = groupScheduleActivitiesIntoChunks(OFFICIAL_SCHEDULE_ACTIVITIES);
      expect(chunks).toHaveLength(8);

      expect(chunks[0].range).toBe("'Schedule'!G3:L23");
      expect(chunks[0].rowCount).toBe(21);

      expect(chunks[1].range).toBe("'Schedule'!G25:L34");
      expect(chunks[1].rowCount).toBe(10);

      expect(chunks[2].range).toBe("'Schedule'!G36:L42");
      expect(chunks[2].rowCount).toBe(7);

      expect(chunks[3].range).toBe("'Schedule'!G44:L51");
      expect(chunks[3].rowCount).toBe(8);

      expect(chunks[4].range).toBe("'Schedule'!G53:L56");
      expect(chunks[4].rowCount).toBe(4);

      expect(chunks[5].range).toBe("'Schedule'!G58:L100");
      expect(chunks[5].rowCount).toBe(43);

      expect(chunks[6].range).toBe("'Schedule'!G102:L102");
      expect(chunks[6].rowCount).toBe(1);

      expect(chunks[7].range).toBe("'Schedule'!G106:L106");
      expect(chunks[7].rowCount).toBe(1);

      const totalRows = chunks.reduce((sum, c) => sum + c.rowCount, 0);
      expect(totalRows).toBe(95);

      for (const chunk of chunks) {
        for (const row of chunk.values) {
          expect(row).toHaveLength(6);
        }
      }
    });

    it('exports all 95 schedule activities as TSV lines for clipboard paste', () => {
      const allTsv = clipboardAllScheduleGtoL(OFFICIAL_SCHEDULE_ACTIVITIES);
      const lines = allTsv.split('\n');
      expect(lines).toHaveLength(95);

      const firstLine = lines[0].split('\t');
      expect(firstLine).toHaveLength(6);
      expect(firstLine[0]).toBe('30');
      expect(firstLine[1]).toBe('08:30');
      expect(firstLine[2]).toBe('09:00');
      expect(firstLine[3]).toBe('Done');
    });
  });
});

