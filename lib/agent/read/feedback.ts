/**
 * Agent feedback projection. Entries use the shared `feedbackEntryFromRow` mapping (same as
 * `GET /api/feedback`). Sessions are the `feedback_sessions` rows; when that table is empty the
 * canonical `FEEDBACK_SESSIONS` ids are returned (they are the valid proposal targets, M8) and
 * `sessionsSource` says so. A database error is never masked.
 */
import { asc } from 'drizzle-orm';
import { feedbackEntries, feedbackSessions } from '@/lib/db/schema';
import { FEEDBACK_SESSIONS } from '@/lib/feedback';
import { feedbackEntryFromRow } from '@/lib/feedback-db';
import type { FeedbackEntry } from '@/lib/types/feedback';
import type { AgentExecutor } from '../audit';

export interface AgentFeedbackSession {
  id: string;
  title: string;
  topic: string;
  pic: string;
  rowNumber: number;
  department: string;
}

export interface AgentFeedbackEntry extends FeedbackEntry {
  rowNumber: number;
  /** `feedback_entries.updated_at`; the staleness token for proposals. */
  updatedAt: string;
}

export interface AgentFeedbackView {
  sessions: AgentFeedbackSession[];
  sessionsSource: 'database' | 'catalog';
  entries: AgentFeedbackEntry[];
}

export async function readFeedback(executor: AgentExecutor): Promise<AgentFeedbackView> {
  const sessionRows = await executor.select().from(feedbackSessions).orderBy(asc(feedbackSessions.rowNumber));
  const entryRows = await executor.select().from(feedbackEntries).orderBy(asc(feedbackEntries.rowNumber));

  const fromDatabase = sessionRows.length > 0;
  const sessions: AgentFeedbackSession[] = fromDatabase
    ? sessionRows.map((row) => ({
        id: row.id,
        title: row.title,
        topic: row.topic,
        pic: row.pic,
        rowNumber: row.rowNumber,
        department: row.department,
      }))
    : FEEDBACK_SESSIONS.map((session) => ({
        id: session.id,
        title: session.title,
        topic: session.topic ?? session.title,
        pic: session.pic,
        rowNumber: session.rowNumber,
        department: session.department ?? '',
      }));

  return {
    sessions,
    sessionsSource: fromDatabase ? 'database' : 'catalog',
    entries: entryRows.map((row) => ({ ...feedbackEntryFromRow(row), rowNumber: row.rowNumber, updatedAt: row.updatedAt })),
  };
}
