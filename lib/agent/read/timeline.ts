/** Agent timeline projection (`timeline_stages`, ordered by stage number). */
import { asc } from 'drizzle-orm';
import { timelineStages } from '@/lib/db/schema';
import type { AgentExecutor } from '../audit';

export interface AgentTimelineStage {
  id: string;
  stageNumber: string;
  stageName: string;
  /** `DD/MM/YYYY` as stored. */
  startDate: string;
  endDate: string;
  objective: string;
  keyActivities: string;
  outputsEvidence: string;
  minimumDuration: string;
  completedEvidence: string[];
  /** `timeline_stages.updated_at` (nullable); the staleness token for proposals. */
  updatedAt: string | null;
}

export async function listTimelineStages(executor: AgentExecutor): Promise<AgentTimelineStage[]> {
  const rows = await executor.select().from(timelineStages).orderBy(asc(timelineStages.stageNumber));
  return rows.map((row) => ({
    id: row.id,
    stageNumber: row.stageNumber,
    stageName: row.stageName,
    startDate: row.startDate,
    endDate: row.endDate,
    objective: row.objective,
    keyActivities: row.keyActivities,
    outputsEvidence: row.outputsEvidence,
    minimumDuration: row.minimumDuration,
    completedEvidence: Array.isArray(row.completedEvidence)
      ? row.completedEvidence.filter((item): item is string => typeof item === 'string')
      : [],
    updatedAt: row.updatedAt,
  }));
}
