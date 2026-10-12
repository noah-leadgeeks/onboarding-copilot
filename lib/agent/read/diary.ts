/**
 * Agent diary projection: `diary_topics` (catalog rows) merged with `diary_entries` (the user's
 * text) by `row_number`. Without an entry the topic's defaults are shown and `updatedAt` is null.
 */
import { asc, eq } from 'drizzle-orm';
import { diaryEntries, diaryTopics } from '@/lib/db/schema';
import type { AgentExecutor } from '../audit';

export type DiaryTopicRow = typeof diaryTopics.$inferSelect;
export type DiaryEntryRow = typeof diaryEntries.$inferSelect;

export interface AgentDiaryItem {
  rowNumber: number;
  /** Topic columns; null when an entry exists without a matching topic row. */
  week: string | null;
  day: string | null;
  date: string | null;
  activityCount: string | null;
  pic: string | null;
  topic: string | null;
  learned: string;
  notes: string;
  /** True when a `diary_entries` row exists for this row number. */
  hasEntry: boolean;
  /** The entry's `updated_at` (staleness token for proposals); null when there is no entry. */
  updatedAt: string | null;
}

export function mergeDiaryItem(topic: DiaryTopicRow | undefined, entry: DiaryEntryRow | undefined): AgentDiaryItem | null {
  const rowNumber = topic?.rowNumber ?? entry?.rowNumber;
  if (rowNumber === undefined) return null;
  return {
    rowNumber,
    week: topic?.week ?? null,
    day: topic?.day ?? null,
    date: topic?.date ?? null,
    activityCount: topic?.activityCount ?? null,
    pic: topic?.pic ?? null,
    topic: topic?.topic ?? null,
    learned: entry ? entry.learned : topic?.defaultLearned ?? '',
    notes: entry ? entry.notes : topic?.defaultNotes ?? '',
    hasEntry: Boolean(entry),
    updatedAt: entry?.updatedAt ?? null,
  };
}

export async function listDiaryItems(executor: AgentExecutor): Promise<AgentDiaryItem[]> {
  const topics = await executor.select().from(diaryTopics).orderBy(asc(diaryTopics.rowNumber));
  const entries = await executor.select().from(diaryEntries).orderBy(asc(diaryEntries.rowNumber));
  const topicByRow = new Map(topics.map((topic) => [topic.rowNumber, topic]));
  const entryByRow = new Map(entries.map((entry) => [entry.rowNumber, entry]));
  const rowNumbers = [...new Set([...topicByRow.keys(), ...entryByRow.keys()])].sort((a, b) => a - b);
  return rowNumbers
    .map((row) => mergeDiaryItem(topicByRow.get(row), entryByRow.get(row)))
    .filter((item): item is AgentDiaryItem => item !== null);
}

export async function getDiaryItem(executor: AgentExecutor, rowNumber: number): Promise<AgentDiaryItem | null> {
  const topics = await executor.select().from(diaryTopics).where(eq(diaryTopics.rowNumber, rowNumber)).limit(1);
  const entries = await executor.select().from(diaryEntries).where(eq(diaryEntries.rowNumber, rowNumber)).limit(1);
  return mergeDiaryItem(topics[0], entries[0]);
}
