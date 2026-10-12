import { FEEDBACK_RATING_KEYS, LIKERT_MAX, LIKERT_MIN, QUESTION_ADDRESSING_OPTIONS } from './feedback';
import { REVIEW_CRITERIA_IDS, STANDARD_SCORES } from '../reviews';

describe('exported validator constants', () => {
  it('has the six rating keys', () => {
    expect([...FEEDBACK_RATING_KEYS]).toEqual(['communication', 'alignment', 'understanding', 'readiness', 'pace', 'overall']);
  });
  it('has Likert bounds 1..6', () => {
    expect([LIKERT_MIN, LIKERT_MAX]).toEqual([1, 6]);
  });
  it('has the three addressing strings', () => {
    expect([...QUESTION_ADDRESSING_OPTIONS]).toEqual([
      'Chat response is fine',
      "I don't have any questions today",
      'I’d like to schedule aN online live meeting',
    ]);
  });
  it('has non-empty unique review criteria ids', () => {
    expect(REVIEW_CRITERIA_IDS.length).toBeGreaterThan(0);
    expect(new Set(REVIEW_CRITERIA_IDS).size).toBe(REVIEW_CRITERIA_IDS.length);
  });
  it('re-exports STANDARD_SCORES', () => {
    expect([...STANDARD_SCORES]).toEqual([60, 70, 80, 90, 100]);
  });
});
