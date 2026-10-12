/**
 * `schedule` domain: `update` of an existing `activities` row by id (no delete, D1). Only the
 * user-editable progress columns; never `actualStart`/`actualEnd` or catalog columns.
 */
import { eq, sql } from 'drizzle-orm';
import { activities } from '@/lib/db/schema';
import type { DomainModule, ProposalChanges, TargetKey } from './types';
import {
  fail,
  isIntInRange,
  ok,
  pickFields,
  snapshotSelection,
  textField,
  toSnapshot,
  validateChangeSet,
  validateClock,
  validateHttpsUrl,
  validateIdKey,
  validateTargetShape,
  type FieldSpec,
} from './validate';

export const SCHEDULE_PROGRESS_VALUES = ['', 'Done', 'In Progress', 'On-Hold', 'Reschedule'] as const;
const PROGRESS_SET: ReadonlySet<string> = new Set(SCHEDULE_PROGRESS_VALUES);
const MAX_DURATION_MINUTES = 24 * 60 * 31;

const SPECS: Readonly<Record<string, FieldSpec>> = {
  progress: {
    validate: (value, field) =>
      typeof value === 'string' && PROGRESS_SET.has(value)
        ? ok(value)
        : fail(`"${field}" must be one of: ${SCHEDULE_PROGRESS_VALUES.map((v) => JSON.stringify(v)).join(', ')}.`),
  },
  startTime: { validate: (value, field) => validateClock(field, value) },
  endTime: { validate: (value, field) => validateClock(field, value) },
  durationMinutes: {
    validate: (value, field) =>
      value === null || isIntInRange(value, 0, MAX_DURATION_MINUTES)
        ? ok(value as number | null)
        : fail(`"${field}" must be an integer >= 0 or null.`),
  },
  notes: textField,
  materialsLink: { validate: (value, field) => validateHttpsUrl(field, value) },
};

const FIELDS = Object.keys(SPECS);

function activityId(key: TargetKey): string {
  return String(key.id);
}

export const scheduleDomain: DomainModule = {
  domain: 'schedule',
  table: 'activities',
  operations: ['update'],
  fields: FIELDS,

  validateTarget(raw) {
    const shape = validateTargetShape(raw, ['id']);
    if (!shape.ok) return shape;
    const id = validateIdKey('id', shape.value.id);
    return id.ok ? ok({ id: id.value }) : id;
  },

  validateChanges(operation, raw, context) {
    return validateChangeSet(operation, raw, SPECS, context);
  },

  async readSnapshot(executor, key) {
    const rows = await executor
      .select(snapshotSelection(activities, FIELDS, activities.updatedAt))
      .from(activities)
      .where(eq(activities.id, activityId(key)))
      .limit(1);
    return rows[0] ? toSnapshot(rows[0], FIELDS) : null;
  },

  async apply(tx, key, changes: ProposalChanges | 'delete') {
    if (changes === 'delete') throw new Error('schedule: delete is not a supported operation');
    const touched = Object.keys(changes).filter((field) => FIELDS.includes(field));
    if (touched.length === 0) throw new Error('schedule: no whitelisted fields to apply');
    const set: Record<string, unknown> = { updatedAt: sql`now()` };
    for (const field of touched) set[field] = changes[field];
    const rows = await tx
      .update(activities)
      .set(set as Partial<typeof activities.$inferInsert>)
      .where(eq(activities.id, activityId(key)))
      .returning(snapshotSelection(activities, touched, activities.updatedAt));
    if (!rows[0]) return { applied: false, reason: 'target_missing' };
    return { applied: true, after: pickFields(rows[0], touched) };
  },
};
