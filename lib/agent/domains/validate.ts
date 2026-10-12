/** Hand-rolled validators shared by the domain modules (no schema library, plan Approach 9). */
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { ChangeContext, JsonObject, JsonValue, ProposalOperation, Validated, ValidatedChanges } from './types';

export const MAX_TEXT_LENGTH = 10_000;
export const MAX_URL_LENGTH = 2_000;

export function ok<T>(value: T): Validated<T> {
  return { ok: true, value };
}

export function fail<T = never>(message: string): Validated<T> {
  return { ok: false, message };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Field names are echoed in messages; keep them short and printable. */
export function quoteField(name: string): string {
  return JSON.stringify(name.slice(0, 40));
}

/** First key of `value` not in `allowed`, or null. */
export function unknownKey(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  const allowedSet = new Set(allowed);
  return Object.keys(value).find((key) => !allowedSet.has(key)) ?? null;
}

/**
 * Formula-like text (S5): after leading spaces, starts with `=`, `+`, `-`, `@`, tab or CR. Only
 * spaces are skipped so a leading tab/CR is itself detected.
 */
export function isFormulaLike(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value.replace(/^ +/, ''));
}

export function validateText(field: string, value: unknown, max = MAX_TEXT_LENGTH): Validated<string> {
  if (typeof value !== 'string') return fail(`${quoteField(field)} must be a string.`);
  if (value.length > max) return fail(`${quoteField(field)} must be at most ${max} characters.`);
  return ok(value);
}

/** `HH:MM` 24-hour clock, or `''` to clear. */
export function validateClock(field: string, value: unknown): Validated<string> {
  if (value === '') return ok('');
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return fail(`${quoteField(field)} must be HH:MM (24-hour) or an empty string.`);
  }
  return ok(value);
}

/** Absolute `https://` URL of at most 2 000 characters, or `''` (S5). */
export function validateHttpsUrl(field: string, value: unknown): Validated<string> {
  if (value === '') return ok('');
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) {
    return fail(`${quoteField(field)} must be an https:// URL of at most ${MAX_URL_LENGTH} characters or an empty string.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail(`${quoteField(field)} must be an absolute https:// URL.`);
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || /\s/.test(value)) {
    return fail(`${quoteField(field)} must be an absolute https:// URL without credentials or whitespace.`);
  }
  return ok(value);
}

function isCalendarDate(y: number, m: number, d: number): boolean {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/** `YYYY-MM-DD`, a real calendar date. */
export function validateIsoDate(field: string, value: unknown): Validated<string> {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match || !isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    return fail(`${quoteField(field)} must be a calendar date YYYY-MM-DD.`);
  }
  return ok(value as string);
}

/** `DD/MM/YYYY` as stored in `timeline_stages`, a real calendar date. */
export function validateSheetDate(field: string, value: unknown): Validated<string> {
  const match = typeof value === 'string' ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value) : null;
  if (!match || !isCalendarDate(Number(match[3]), Number(match[2]), Number(match[1]))) {
    return fail(`${quoteField(field)} must be a calendar date DD/MM/YYYY.`);
  }
  return ok(value as string);
}

/** Integer in [min, max] (no strings, no fractions). */
export function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** A positive integer target key (no strings). */
export function validatePositiveIntKey(field: string, value: unknown, max = 999_999): Validated<number> {
  if (!isIntInRange(value, 1, max)) return fail(`target.${field} must be an integer between 1 and ${max}.`);
  return ok(value);
}

/** Identifier-shaped string keys (`sched-row-12`, `stage-1`). */
export function validateIdKey(field: string, value: unknown): Validated<string> {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    return fail(`target.${field} must be 1-128 characters of [A-Za-z0-9._:-].`);
  }
  return ok(value);
}

/** Target must be an object with exactly `keys`. */
export function validateTargetShape(raw: unknown, keys: readonly string[]): Validated<Record<string, unknown>> {
  if (!isPlainObject(raw)) return fail('target must be an object.');
  const extra = unknownKey(raw, keys);
  if (extra !== null) return fail(`Unknown target key ${quoteField(extra)}. Allowed: ${keys.join(', ')}.`);
  const missing = keys.find((key) => !(key in raw));
  if (missing) return fail(`target.${missing} is required.`);
  return ok(raw);
}

export type FieldValidator = (value: unknown, field: string) => Validated<JsonValue>;

export interface FieldSpec {
  validate: FieldValidator;
  /** Text that can reach a spreadsheet: flag formula-like values (S5). */
  formulaCheck?: boolean;
  /** Ratings field: requires proposal-level `ratingsSource: 'user-dictated'` (S11, ADR-0003). */
  ratings?: boolean;
}

/**
 * Validates `changes` against a whitelist. `delete` takes no changes (absent or `{}`); `update`
 * needs at least one whitelisted key. Unknown keys are rejected (never silently dropped).
 */
export function validateChangeSet(
  operation: ProposalOperation,
  raw: unknown,
  specs: Readonly<Record<string, FieldSpec>>,
  context: ChangeContext
): Validated<ValidatedChanges> {
  if (operation === 'delete') {
    if (raw === undefined || (isPlainObject(raw) && Object.keys(raw).length === 0)) {
      return ok({ changes: {}, warnings: [] });
    }
    return fail('A delete proposal takes no changes.');
  }
  if (!isPlainObject(raw)) return fail('changes must be an object.');
  const allowed = Object.keys(specs);
  const extra = unknownKey(raw, allowed);
  if (extra !== null) return fail(`Unknown or non-proposable field ${quoteField(extra)}. Allowed: ${allowed.join(', ')}.`);
  const keys = Object.keys(raw);
  if (keys.length === 0) return fail('changes must contain at least one field.');

  const changes: JsonObject = {};
  const warnings: string[] = [];
  for (const key of keys) {
    const spec = specs[key];
    const result = spec.validate(raw[key], key);
    if (!result.ok) return result;
    if (spec.ratings && context.ratingsSource !== 'user-dictated') {
      return fail(`${quoteField(key)} requires ratingsSource "user-dictated" (ratings must be dictated by the user).`);
    }
    if (spec.formulaCheck && typeof result.value === 'string' && isFormulaLike(result.value)) {
      warnings.push(`formula_like:${key}`);
    }
    changes[key] = result.value;
  }
  return ok({ changes, warnings });
}

export const textField: FieldSpec = { validate: (value, field) => validateText(field, value), formulaCheck: true };

/** Selection of the whitelisted columns plus `updated_at::text` (M4: full precision for timestamptz). */
export function snapshotSelection(
  table: PgTable,
  fields: readonly string[],
  updatedAt: PgColumn
): Record<string, PgColumn | SQL> {
  const columns = table as unknown as Record<string, PgColumn>;
  const selection: Record<string, PgColumn | SQL> = {};
  for (const field of fields) selection[field] = columns[field];
  selection.updatedAt = sql<string | null>`${updatedAt}::text`;
  return selection;
}

/** Splits a snapshot row into `before` (whitelisted fields) and `updatedAt`. */
export function toSnapshot(row: Record<string, unknown>, fields: readonly string[]): { before: JsonObject; updatedAt: string | null } {
  const before: JsonObject = {};
  for (const field of fields) before[field] = (row[field] ?? null) as JsonValue;
  const updatedAt = row.updatedAt;
  return { before, updatedAt: typeof updatedAt === 'string' ? updatedAt : null };
}

/** The touched fields of a returned row (`after`, S9). */
export function pickFields(row: Record<string, unknown>, fields: readonly string[]): JsonObject {
  const out: JsonObject = {};
  for (const field of fields) out[field] = (row[field] ?? null) as JsonValue;
  return out;
}

/** Fresh ISO timestamp for the text `updated_at` columns (M2). */
export function nowIso(): string {
  return new Date().toISOString();
}
