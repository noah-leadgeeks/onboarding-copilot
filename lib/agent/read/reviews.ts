/** Agent monthly-review projection (`monthly_reviews`, ordered by month). Absent months are omitted. */
import { asc } from 'drizzle-orm';
import { monthlyReviews } from '@/lib/db/schema';
import type { AgentExecutor } from '../audit';

export interface AgentReview {
  month: number;
  achievements: string;
  challenges: string;
  goalsNextMonth: string;
  technicalRatings: Record<string, number>;
  valuesRatings: Record<string, number>;
  /** `monthly_reviews.updated_at`; the staleness token for proposals. */
  updatedAt: string;
}

/** Keeps only finite numeric values of a stored jsonb ratings object. */
export function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, score] of Object.entries(value as Record<string, unknown>)) {
    if (typeof score === 'number' && Number.isFinite(score)) out[key] = score;
  }
  return out;
}

export async function listReviews(executor: AgentExecutor): Promise<AgentReview[]> {
  const rows = await executor.select().from(monthlyReviews).orderBy(asc(monthlyReviews.month));
  return rows.map((row) => ({
    month: row.month,
    achievements: row.achievements,
    challenges: row.challenges,
    goalsNextMonth: row.goalsNextMonth,
    technicalRatings: numericRecord(row.technicalRatings),
    valuesRatings: numericRecord(row.valuesRatings),
    updatedAt: row.updatedAt,
  }));
}
