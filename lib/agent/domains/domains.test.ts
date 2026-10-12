/** Step 6 domain validators: whitelists, URL rule, formula-like warnings, ratings rules (S5, S9, S11). */
import { FEEDBACK_RATING_KEYS, QUESTION_ADDRESSING_OPTIONS } from '@/lib/types/feedback';
import { REVIEW_CRITERIA_IDS } from '@/lib/reviews';
import { DOMAINS, getDomain, PROPOSAL_DOMAINS } from './index';
import { isFormulaLike, validateHttpsUrl } from './validate';

const USER = { ratingsSource: 'user-dictated' as const };
const NONE = { ratingsSource: null };

function fullRatings(score = 5): Record<string, number> {
  return Object.fromEntries(FEEDBACK_RATING_KEYS.map((key) => [key, score]));
}

describe('domain registry', () => {
  it('has exactly the five proposable domains with the D1 operations', () => {
    expect(Object.keys(DOMAINS).sort()).toEqual([...PROPOSAL_DOMAINS].sort());
    expect(DOMAINS.schedule.operations).toEqual(['update']);
    expect(DOMAINS.timeline.operations).toEqual(['update']);
    expect(DOMAINS.diary.operations).toEqual(['update', 'delete']);
    expect(DOMAINS.feedback.operations).toEqual(['update', 'delete']);
    expect(DOMAINS.reviews.operations).toEqual(['update', 'delete']);
    expect(getDomain('glossary')).toBeNull();
    expect(getDomain('__proto__')).toBeNull();
  });

  it('whitelists exactly the planned fields', () => {
    expect(DOMAINS.schedule.fields).toEqual(['progress', 'startTime', 'endTime', 'durationMinutes', 'notes', 'materialsLink']);
    expect(DOMAINS.diary.fields).toEqual(['learned', 'notes']);
    expect(DOMAINS.feedback.fields).toEqual(['date', 'ratings', 'hasQuestions', 'questionExplanation', 'questionAddressing', 'suggestions']);
    expect(DOMAINS.reviews.fields).toEqual(['achievements', 'challenges', 'goalsNextMonth', 'technicalRatings', 'valuesRatings']);
    expect(DOMAINS.timeline.fields).toEqual(['completedEvidence', 'startDate', 'endDate']);
  });
});

describe('formula-like detection (S5)', () => {
  it('flags =, +, -, @, tab and CR after leading spaces', () => {
    for (const value of ['=1+1', '+1', '-20 min', '@user', '\tx', '\rx', '   =SUM(A1)']) expect(isFormulaLike(value)).toBe(true);
    for (const value of ['plain', '', ' a=b', '1-2']) expect(isFormulaLike(value)).toBe(false);
  });

  it('produces formula_like:<field> warnings only for text fields', () => {
    const result = DOMAINS.reviews.validateChanges('update', { achievements: '=cmd', challenges: 'fine' }, NONE);
    expect(result).toEqual({ ok: true, value: { changes: { achievements: '=cmd', challenges: 'fine' }, warnings: ['formula_like:achievements'] } });
  });
});

describe('URL rule', () => {
  it('accepts https URLs and empty string only', () => {
    expect(validateHttpsUrl('materialsLink', 'https://docs.example.com/a?b=1').ok).toBe(true);
    expect(validateHttpsUrl('materialsLink', '').ok).toBe(true);
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'ftp://x', '/relative', 'https://user:pw@example.com', `https://example.com/${'a'.repeat(2000)}`, 42, null]) {
      expect(validateHttpsUrl('materialsLink', bad).ok).toBe(false);
    }
  });
});

describe('schedule', () => {
  it('validates progress, clocks, duration', () => {
    const good = DOMAINS.schedule.validateChanges('update', { progress: 'On-Hold', startTime: '23:59', endTime: '', durationMinutes: null }, NONE);
    expect(good.ok).toBe(true);
    for (const bad of [{ progress: 'done' }, { startTime: '24:00' }, { durationMinutes: -1 }, { durationMinutes: 1.5 }, { durationMinutes: '30' }, { actualEnd: '10:00' }, { topic: 'x' }]) {
      expect(DOMAINS.schedule.validateChanges('update', bad, NONE).ok).toBe(false);
    }
  });

  it('target must be { id } with a safe id', () => {
    expect(DOMAINS.schedule.validateTarget({ id: 'sched-row-12' })).toEqual({ ok: true, value: { id: 'sched-row-12' } });
    for (const bad of [{}, { id: '' }, { id: 'a b' }, { id: 12 }, { id: 'x', rowNumber: 1 }, null, []]) {
      expect(DOMAINS.schedule.validateTarget(bad).ok).toBe(false);
    }
  });
});

describe('feedback', () => {
  it('ratings replace the whole object: all six keys, integers 1-6, ratingsSource required', () => {
    expect(DOMAINS.feedback.validateChanges('update', { ratings: fullRatings() }, USER)).toEqual({
      ok: true,
      value: { changes: { ratings: fullRatings() }, warnings: [] },
    });
    expect(DOMAINS.feedback.validateChanges('update', { ratings: fullRatings() }, NONE).ok).toBe(false);
    const partial = fullRatings();
    delete partial.pace;
    for (const bad of [partial, { ...fullRatings(), extra: 3 }, fullRatings(7), fullRatings(0), { ...fullRatings(), overall: 4.5 }, [1, 2]]) {
      expect(DOMAINS.feedback.validateChanges('update', { ratings: bad }, USER).ok).toBe(false);
    }
  });

  it('validates date, addressing options and booleans', () => {
    expect(DOMAINS.feedback.validateChanges('update', { date: '2026-02-28', questionAddressing: QUESTION_ADDRESSING_OPTIONS[0], hasQuestions: false }, NONE).ok).toBe(true);
    for (const bad of [{ date: '2026-02-30' }, { date: '28/02/2026' }, { questionAddressing: 'whatever' }, { hasQuestions: 'yes' }]) {
      expect(DOMAINS.feedback.validateChanges('update', bad, NONE).ok).toBe(false);
    }
  });

  it('target accepts any printable sessionId shape (existence is checked by the snapshot, M8)', () => {
    expect(DOMAINS.feedback.validateTarget({ sessionId: 'Introduction to Company' }).ok).toBe(true);
    expect(DOMAINS.feedback.validateTarget({ sessionId: 'row-3\n' }).ok).toBe(false);
    expect(DOMAINS.feedback.validateTarget({ sessionId: '' }).ok).toBe(false);
  });
});

describe('reviews', () => {
  it('score maps: criteria ids and STANDARD_SCORES only, ratingsSource required; {} clears', () => {
    const id = REVIEW_CRITERIA_IDS[0];
    expect(DOMAINS.reviews.validateChanges('update', { technicalRatings: { [id]: 80 } }, USER).ok).toBe(true);
    expect(DOMAINS.reviews.validateChanges('update', { valuesRatings: {} }, USER).ok).toBe(true);
    expect(DOMAINS.reviews.validateChanges('update', { technicalRatings: { [id]: 80 } }, NONE).ok).toBe(false);
    expect(DOMAINS.reviews.validateChanges('update', { technicalRatings: { [id]: 85 } }, USER).ok).toBe(false);
    expect(DOMAINS.reviews.validateChanges('update', { technicalRatings: { 'not-a-criterion': 80 } }, USER).ok).toBe(false);
  });

  it('target month is 1-3', () => {
    expect(DOMAINS.reviews.validateTarget({ month: 3 }).ok).toBe(true);
    for (const month of [0, 4, '1', 1.5]) expect(DOMAINS.reviews.validateTarget({ month }).ok).toBe(false);
  });
});

describe('timeline', () => {
  it('completedEvidence is a string array; dates DD/MM/YYYY', () => {
    expect(DOMAINS.timeline.validateChanges('update', { completedEvidence: [], startDate: '29/02/2028' }, NONE).ok).toBe(true);
    for (const bad of [{ completedEvidence: 'a' }, { completedEvidence: [1] }, { startDate: '2026-09-01' }, { endDate: '31/02/2026' }]) {
      expect(DOMAINS.timeline.validateChanges('update', bad, NONE).ok).toBe(false);
    }
  });
});

describe('delete', () => {
  it('takes no changes', () => {
    expect(DOMAINS.diary.validateChanges('delete', undefined, NONE)).toEqual({ ok: true, value: { changes: {}, warnings: [] } });
    expect(DOMAINS.diary.validateChanges('delete', {}, NONE).ok).toBe(true);
    expect(DOMAINS.diary.validateChanges('delete', { learned: '' }, NONE).ok).toBe(false);
  });
});
