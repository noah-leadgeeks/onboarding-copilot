/**
 * `diary` domain: `update` upserts `diary_entries` by `row_number` (`id = entry-<row>`); `delete`
 * removes the entry row (the topic stays, so the diary shows the catalog defaults again, D1).
 * The target row number must exist in `diary_topics`.
 */
import { eq } from 'drizzle-orm';
import { diaryEntries, diaryTopics } from '@/lib/db/schema';
import type { DomainModule, TargetKey } from './types';
import {
  nowIso,
  ok,
  pickFields,
  snapshotSelection,
  textField,
  toSnapshot,
  validateChangeSet,
  validatePositiveIntKey,
  validateTargetShape,
  type FieldSpec,
} from './validate';

const SPECS: Readonly<Record<string, FieldSpec>> = {
  learned: textField,
  notes: textField,
};

const FIELDS = Object.keys(SPECS);

function rowNumberOf(key: TargetKey): number {
  return Number(key.rowNumber);
}

export const diaryDomain: DomainModule = {
  domain: 'diary',
  table: 'diary_entries',
  operations: ['update', 'delete'],
  fields: FIELDS,

  validateTarget(raw) {
    const shape = validateTargetShape(raw, ['rowNumber']);
    if (!shape.ok) return shape;
    const row = validatePositiveIntKey('rowNumber', shape.value.rowNumber);
    return row.ok ? ok({ rowNumber: row.value }) : row;
  },

  validateChanges(operation, raw, context) {
    return validateChangeSet(operation, raw, SPECS, context);
  },

  async readSnapshot(executor, key) {
    const rowNumber = rowNumberOf(key);
    const topics = await executor
      .select({ rowNumber: diaryTopics.rowNumber })
      .from(diaryTopics)
      .where(eq(diaryTopics.rowNumber, rowNumber))
      .limit(1);
    if (!topics[0]) return null;
    const rows = await executor
      .select(snapshotSelection(diaryEntries, FIELDS, diaryEntries.updatedAt))
      .from(diaryEntries)
      .where(eq(diaryEntries.rowNumber, rowNumber))
      .limit(1);
    return rows[0] ? toSnapshot(rows[0], FIELDS) : { before: null, updatedAt: null };
  },

  async apply(tx, key, changes) {
    const rowNumber = rowNumberOf(key);
    if (changes === 'delete') {
      const deleted = await tx
        .delete(diaryEntries)
        .where(eq(diaryEntries.rowNumber, rowNumber))
        .returning({ rowNumber: diaryEntries.rowNumber });
      return deleted[0] ? { applied: true, after: null } : { applied: false, reason: 'target_missing' };
    }

    const touched = Object.keys(changes).filter((field) => FIELDS.includes(field));
    if (touched.length === 0) throw new Error('diary: no whitelisted fields to apply');
    const updatedAt = nowIso();
    const set: Partial<typeof diaryEntries.$inferInsert> = { updatedAt };
    for (const field of touched) (set as Record<string, unknown>)[field] = changes[field];

    const updated = await tx
      .update(diaryEntries)
      .set(set)
      .where(eq(diaryEntries.rowNumber, rowNumber))
      .returning(snapshotSelection(diaryEntries, touched, diaryEntries.updatedAt));
    if (updated[0]) return { applied: true, after: pickFields(updated[0], touched) };

    // No entry yet: unlisted fields keep what the user sees today, the topic's defaults (S9).
    const topics = await tx
      .select({ defaultLearned: diaryTopics.defaultLearned, defaultNotes: diaryTopics.defaultNotes })
      .from(diaryTopics)
      .where(eq(diaryTopics.rowNumber, rowNumber))
      .limit(1);
    const topic = topics[0];
    if (!topic) return { applied: false, reason: 'target_missing' };
    const inserted = await tx
      .insert(diaryEntries)
      .values({
        id: `entry-${rowNumber}`,
        rowNumber,
        learned: typeof changes.learned === 'string' ? changes.learned : topic.defaultLearned ?? '',
        notes: typeof changes.notes === 'string' ? changes.notes : topic.defaultNotes ?? '',
        updatedAt,
      })
      .onConflictDoNothing()
      .returning(snapshotSelection(diaryEntries, touched, diaryEntries.updatedAt));
    if (!inserted[0]) return { applied: false, reason: 'insert_conflict' };
    return { applied: true, after: pickFields(inserted[0], touched) };
  },
};
