/** Agent glossary projection (`training_modules`, ordered by id). Database only; no catalog fallback. */
import { asc } from 'drizzle-orm';
import { trainingModules } from '@/lib/db/schema';
import type { MaterialLink, TrainingModule } from '@/lib/glossary';
import type { AgentExecutor } from '../audit';

function materialLinks(value: unknown): MaterialLink[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const links = value.filter(
    (item): item is MaterialLink =>
      Boolean(item) && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string'
  );
  return links.length > 0 ? links : undefined;
}

export async function listTrainingModules(executor: AgentExecutor): Promise<TrainingModule[]> {
  const rows = await executor.select().from(trainingModules).orderBy(asc(trainingModules.id));
  return rows.map((row) => ({
    id: row.id,
    topic: row.topic,
    pic: row.pic,
    objectives: row.objectives,
    frameworkMaterials: row.frameworkMaterials,
    materials: row.materials,
    media: row.media,
    durationMinutes: row.durationMinutes,
    materialAccess: row.materialAccess || undefined,
    materialLinks: materialLinks(row.materialLinks),
    notes: row.notes || undefined,
  }));
}
