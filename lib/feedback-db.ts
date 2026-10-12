/**
 * Shared mapping from a `feedback_entries` database row to the app's `FeedbackEntry` shape.
 * Used by `GET /api/feedback` and the agent read endpoint `GET /api/agent/v1/feedback`.
 */
import type { feedbackEntries } from '@/lib/db/schema';
import type { FeedbackEntry, FeedbackRatings } from '@/lib/types/feedback';

export type FeedbackEntryRow = typeof feedbackEntries.$inferSelect;

export function feedbackEntryFromRow(row: FeedbackEntryRow): FeedbackEntry {
  return {
    sessionId: row.sessionId,
    sessionTitle: row.topic || row.sessionId,
    pic: row.pic || '',
    date: row.date || '',
    // jsonb column; the stored object is written by the app's own feedback form.
    ratings: (row.ratings || {}) as FeedbackRatings,
    hasQuestions: row.hasQuestions ?? false,
    questionExplanation: row.questionExplanation || '',
    questionAddressing: row.questionAddressing || '',
    suggestions: row.suggestions || '',
    createdAt: row.updatedAt,
    updatedAt: row.updatedAt,
  };
}
