/**
 * `feedback` domain: `update` upserts `feedback_entries` by `session_id` (`id = fb-<sessionId>`);
 * `delete` removes the entry row. The target `sessionId` must EXACTLY equal a `feedback_sessions.id`
 * row or a canonical `FEEDBACK_SESSIONS` id (M8): no `findFeedbackSession` fuzzy matching for
 * writes. `ratings` replaces the whole object and requires `ratingsSource: 'user-dictated'` (S11).
 */
import { eq } from 'drizzle-orm';
import { feedbackEntries, feedbackSessions } from '@/lib/db/schema';
import { FEEDBACK_SESSIONS } from '@/lib/feedback';
import { FEEDBACK_RATING_KEYS, LIKERT_MAX, LIKERT_MIN, QUESTION_ADDRESSING_OPTIONS } from '@/lib/types/feedback';
import type { AgentExecutor } from '../audit';
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
  unknownKey,
  validateChangeSet,
  validateIsoDate,
  validateTargetShape,
  type FieldSpec,
} from './validate';

const ADDRESSING_SET: ReadonlySet<string> = new Set(QUESTION_ADDRESSING_OPTIONS);

const SPECS: Readonly<Record<string, FieldSpec>> = {
  date: { validate: (value, field) => validateIsoDate(field, value) },
  ratings: {
    ratings: true,
    validate: (value, field) => {
      if (!isPlainObject(value)) return fail(`"${field}" must be an object with ${FEEDBACK_RATING_KEYS.join(', ')}.`);
      const extra = unknownKey(value, FEEDBACK_RATING_KEYS);
      if (extra !== null) return fail(`Unknown rating key ${JSON.stringify(extra.slice(0, 40))}.`);
      const out: JsonObject = {};
      for (const key of FEEDBACK_RATING_KEYS) {
        const score = value[key];
        if (!isIntInRange(score, LIKERT_MIN, LIKERT_MAX)) {
          return fail(`"${field}.${key}" is required and must be an integer ${LIKERT_MIN}-${LIKERT_MAX}.`);
        }
        out[key] = score;
      }
      return ok(out);
    },
  },
  hasQuestions: {
    validate: (value, field) => (typeof value === 'boolean' ? ok(value) : fail(`"${field}" must be a boolean.`)),
  },
  questionExplanation: textField,
  questionAddressing: {
    validate: (value, field) =>
      typeof value === 'string' && ADDRESSING_SET.has(value)
        ? ok(value)
        : fail(`"${field}" must be one of: ${QUESTION_ADDRESSING_OPTIONS.map((v) => JSON.stringify(v)).join(', ')}.`),
  },
  suggestions: textField,
};

const FIELDS = Object.keys(SPECS);
const MAX_SESSION_ID_LENGTH = 128;

export interface ResolvedFeedbackSession {
  id: string;
  rowNumber: number;
  pic: string;
  topic: string;
}

/**
 * Exact-id resolution (M8): a `feedback_sessions` row with this id, else a canonical
 * `FEEDBACK_SESSIONS` entry with this id. Titles, case variants and `row N` aliases do not match.
 */
export async function resolveFeedbackSession(
  executor: AgentExecutor,
  sessionId: string
): Promise<ResolvedFeedbackSession | null> {
  const rows = await executor
    .select({
      id: feedbackSessions.id,
      rowNumber: feedbackSessions.rowNumber,
      pic: feedbackSessions.pic,
      topic: feedbackSessions.topic,
    })
    .from(feedbackSessions)
    .where(eq(feedbackSessions.id, sessionId))
    .limit(1);
  if (rows[0]) return rows[0];
  const canonical = FEEDBACK_SESSIONS.find((session) => session.id === sessionId);
  if (!canonical) return null;
  return { id: canonical.id, rowNumber: canonical.rowNumber, pic: canonical.pic, topic: canonical.topic ?? canonical.title };
}

function sessionIdOf(key: TargetKey): string {
  return String(key.sessionId);
}

export const feedbackDomain: DomainModule = {
  domain: 'feedback',
  table: 'feedback_entries',
  operations: ['update', 'delete'],
  fields: FIELDS,

  validateTarget(raw) {
    const shape = validateTargetShape(raw, ['sessionId']);
    if (!shape.ok) return shape;
    const sessionId = shape.value.sessionId;
    // Shape only; existence (exact id) is checked by readSnapshot, so a fuzzy-only match is a 404.
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(sessionId)) {
      return fail(`target.sessionId must be a non-empty string of at most ${MAX_SESSION_ID_LENGTH} printable characters.`);
    }
    return ok({ sessionId });
  },

  validateChanges(operation, raw, context) {
    return validateChangeSet(operation, raw, SPECS, context);
  },

  async readSnapshot(executor, key) {
    const session = await resolveFeedbackSession(executor, sessionIdOf(key));
    if (!session) return null;
    const rows = await executor
      .select(snapshotSelection(feedbackEntries, FIELDS, feedbackEntries.updatedAt))
      .from(feedbackEntries)
      .where(eq(feedbackEntries.sessionId, session.id))
      .limit(1);
    return rows[0] ? toSnapshot(rows[0], FIELDS) : { before: null, updatedAt: null };
  },

  async apply(tx, key, changes) {
    const sessionId = sessionIdOf(key);
    if (changes === 'delete') {
      const deleted = await tx
        .delete(feedbackEntries)
        .where(eq(feedbackEntries.sessionId, sessionId))
        .returning({ sessionId: feedbackEntries.sessionId });
      return deleted[0] ? { applied: true, after: null } : { applied: false, reason: 'target_missing' };
    }

    const touched = Object.keys(changes).filter((field) => FIELDS.includes(field));
    if (touched.length === 0) throw new Error('feedback: no whitelisted fields to apply');
    const updatedAt = nowIso();
    const set: Record<string, unknown> = { updatedAt };
    for (const field of touched) set[field] = changes[field];

    const updated = await tx
      .update(feedbackEntries)
      .set(set as Partial<typeof feedbackEntries.$inferInsert>)
      .where(eq(feedbackEntries.sessionId, sessionId))
      .returning(snapshotSelection(feedbackEntries, touched, feedbackEntries.updatedAt));
    if (updated[0]) return { applied: true, after: pickFields(updated[0], touched) };

    // New row: rowNumber/pic/topic come from the exact-matched session (S9).
    const session = await resolveFeedbackSession(tx, sessionId);
    if (!session) return { applied: false, reason: 'target_missing' };
    const inserted = await tx
      .insert(feedbackEntries)
      .values({
        id: `fb-${session.id}`,
        sessionId: session.id,
        rowNumber: session.rowNumber,
        pic: session.pic,
        topic: session.topic,
        date: typeof changes.date === 'string' ? changes.date : new Date().toISOString().slice(0, 10),
        ratings: isPlainObject(changes.ratings) ? changes.ratings : null,
        hasQuestions: typeof changes.hasQuestions === 'boolean' ? changes.hasQuestions : false,
        questionExplanation: typeof changes.questionExplanation === 'string' ? changes.questionExplanation : '',
        questionAddressing: typeof changes.questionAddressing === 'string' ? changes.questionAddressing : '',
        suggestions: typeof changes.suggestions === 'string' ? changes.suggestions : '',
        updatedAt,
      })
      .onConflictDoNothing()
      .returning(snapshotSelection(feedbackEntries, touched, feedbackEntries.updatedAt));
    if (!inserted[0]) return { applied: false, reason: 'insert_conflict' };
    return { applied: true, after: pickFields(inserted[0], touched) };
  },
};
