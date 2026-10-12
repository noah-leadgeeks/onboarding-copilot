/**
 * `reviews` domain: `update` upserts `monthly_reviews` by `month` (insert id `month-<n>`, as the
 * app's reviews route does); `delete` removes the month's row. Rating maps replace the whole stored
 * object, keys are review criteria ids, values are `STANDARD_SCORES`, and both require
 * `ratingsSource: 'user-dictated'` (S11).
 */
import { eq } from 'drizzle-orm';
import { monthlyReviews } from '@/lib/db/schema';
import { REVIEW_CRITERIA_IDS, STANDARD_SCORES } from '@/lib/reviews';
import type { DomainModule, JsonObject, TargetKey } from './types';
import {
  fail,
  isIntInRange,
  isPlainObject,
  nowIso,
  ok,
  pickFields,
  snapshotSelection,
  textField,
  toSnapshot,
  validateChangeSet,
  validateTargetShape,
  type FieldSpec,
  type FieldValidator,
} from './validate';

const CRITERIA_SET: ReadonlySet<string> = new Set(REVIEW_CRITERIA_IDS);
const SCORE_SET: ReadonlySet<number> = new Set<number>(STANDARD_SCORES);

const validateScores: FieldValidator = (value, field) => {
  if (!isPlainObject(value)) return fail(`"${field}" must be an object of criteria id -> score.`);
  const out: JsonObject = {};
  for (const [criterion, score] of Object.entries(value)) {
    if (!CRITERIA_SET.has(criterion)) return fail(`Unknown review criteria id ${JSON.stringify(criterion.slice(0, 40))} in "${field}".`);
    if (typeof score !== 'number' || !SCORE_SET.has(score)) {
      return fail(`"${field}.${criterion}" must be one of ${STANDARD_SCORES.join(', ')}.`);
    }
    out[criterion] = score;
  }
  return ok(out);
};

const SPECS: Readonly<Record<string, FieldSpec>> = {
  achievements: textField,
  challenges: textField,
  goalsNextMonth: textField,
  technicalRatings: { validate: validateScores, ratings: true },
  valuesRatings: { validate: validateScores, ratings: true },
};

const FIELDS = Object.keys(SPECS);

function monthOf(key: TargetKey): number {
  return Number(key.month);
}

export const reviewsDomain: DomainModule = {
  domain: 'reviews',
  table: 'monthly_reviews',
  operations: ['update', 'delete'],
  fields: FIELDS,

  validateTarget(raw) {
    const shape = validateTargetShape(raw, ['month']);
    if (!shape.ok) return shape;
    if (!isIntInRange(shape.value.month, 1, 3)) return fail('target.month must be 1, 2 or 3.');
    return ok({ month: shape.value.month });
  },

  validateChanges(operation, raw, context) {
    return validateChangeSet(operation, raw, SPECS, context);
  },

  async readSnapshot(executor, key) {
    const rows = await executor
      .select(snapshotSelection(monthlyReviews, FIELDS, monthlyReviews.updatedAt))
      .from(monthlyReviews)
      .where(eq(monthlyReviews.month, monthOf(key)))
      .limit(1);
    // Months 1-3 always exist as targets; an absent row is an upsert target.
    return rows[0] ? toSnapshot(rows[0], FIELDS) : { before: null, updatedAt: null };
  },

  async apply(tx, key, changes) {
    const month = monthOf(key);
    if (changes === 'delete') {
      const deleted = await tx
        .delete(monthlyReviews)
        .where(eq(monthlyReviews.month, month))
        .returning({ month: monthlyReviews.month });
      return deleted[0] ? { applied: true, after: null } : { applied: false, reason: 'target_missing' };
    }

    const touched = Object.keys(changes).filter((field) => FIELDS.includes(field));
    if (touched.length === 0) throw new Error('reviews: no whitelisted fields to apply');
    const updatedAt = nowIso();
    const set: Record<string, unknown> = { updatedAt };
    for (const field of touched) set[field] = changes[field];

    const updated = await tx
      .update(monthlyReviews)
      .set(set as Partial<typeof monthlyReviews.$inferInsert>)
      .where(eq(monthlyReviews.month, month))
      .returning(snapshotSelection(monthlyReviews, touched, monthlyReviews.updatedAt));
    if (updated[0]) return { applied: true, after: pickFields(updated[0], touched) };

    const text = (field: string) => (typeof changes[field] === 'string' ? (changes[field] as string) : '');
    const inserted = await tx
      .insert(monthlyReviews)
      .values({
        id: `month-${month}`,
        month,
        achievements: text('achievements'),
        challenges: text('challenges'),
        goalsNextMonth: text('goalsNextMonth'),
        technicalRatings: isPlainObject(changes.technicalRatings) ? changes.technicalRatings : null,
        valuesRatings: isPlainObject(changes.valuesRatings) ? changes.valuesRatings : null,
        updatedAt,
      })
      .onConflictDoNothing()
      .returning(snapshotSelection(monthlyReviews, touched, monthlyReviews.updatedAt));
    if (!inserted[0]) return { applied: false, reason: 'insert_conflict' };
    return { applied: true, after: pickFields(inserted[0], touched) };
  },
};
