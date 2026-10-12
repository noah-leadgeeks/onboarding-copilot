/**
 * `timeline` domain: `update` of an existing `timeline_stages` row by id (no delete, D1).
 * `completedEvidence` replaces the stored array (S9); dates are `DD/MM/YYYY` as stored.
 */
import { eq } from 'drizzle-orm';
import { timelineStages } from '@/lib/db/schema';
import type { DomainModule, TargetKey } from './types';
import {
  fail,
  nowIso,
  ok,
  pickFields,
  snapshotSelection,
  toSnapshot,
  validateChangeSet,
  validateIdKey,
  validateSheetDate,
  validateTargetShape,
  type FieldSpec,
} from './validate';

const MAX_EVIDENCE_ITEMS = 100;
const MAX_EVIDENCE_ITEM_LENGTH = 2_000;

const SPECS: Readonly<Record<string, FieldSpec>> = {
  completedEvidence: {
    validate: (value, field) => {
      if (!Array.isArray(value) || value.length > MAX_EVIDENCE_ITEMS) {
        return fail(`"${field}" must be an array of at most ${MAX_EVIDENCE_ITEMS} strings.`);
      }
      for (const item of value) {
        if (typeof item !== 'string' || item.length > MAX_EVIDENCE_ITEM_LENGTH) {
          return fail(`Every "${field}" item must be a string of at most ${MAX_EVIDENCE_ITEM_LENGTH} characters.`);
        }
      }
      return ok([...(value as string[])]);
    },
  },
  startDate: { validate: (value, field) => validateSheetDate(field, value) },
  endDate: { validate: (value, field) => validateSheetDate(field, value) },
};

const FIELDS = Object.keys(SPECS);

function stageIdOf(key: TargetKey): string {
  return String(key.stageId);
}

export const timelineDomain: DomainModule = {
  domain: 'timeline',
  table: 'timeline_stages',
  operations: ['update'],
  fields: FIELDS,

  validateTarget(raw) {
    const shape = validateTargetShape(raw, ['stageId']);
    if (!shape.ok) return shape;
    const id = validateIdKey('stageId', shape.value.stageId);
    return id.ok ? ok({ stageId: id.value }) : id;
  },

  validateChanges(operation, raw, context) {
    return validateChangeSet(operation, raw, SPECS, context);
  },

  async readSnapshot(executor, key) {
    const rows = await executor
      .select(snapshotSelection(timelineStages, FIELDS, timelineStages.updatedAt))
      .from(timelineStages)
      .where(eq(timelineStages.id, stageIdOf(key)))
      .limit(1);
    return rows[0] ? toSnapshot(rows[0], FIELDS) : null;
  },

  async apply(tx, key, changes) {
    if (changes === 'delete') throw new Error('timeline: delete is not a supported operation');
    const touched = Object.keys(changes).filter((field) => FIELDS.includes(field));
    if (touched.length === 0) throw new Error('timeline: no whitelisted fields to apply');
    const set: Record<string, unknown> = { updatedAt: nowIso() };
    for (const field of touched) set[field] = changes[field];
    const rows = await tx
      .update(timelineStages)
      .set(set as Partial<typeof timelineStages.$inferInsert>)
      .where(eq(timelineStages.id, stageIdOf(key)))
      .returning(snapshotSelection(timelineStages, touched, timelineStages.updatedAt));
    if (!rows[0]) return { applied: false, reason: 'target_missing' };
    return { applied: true, after: pickFields(rows[0], touched) };
  },
};
