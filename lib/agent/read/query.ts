/**
 * Query-string and path-parameter validation for agent read routes, plus the database-error
 * boundary (a failed read is 500 `database_error`; never a catalog or proxy fallback, M9).
 */
import { describeError } from '../errors';
import { agentError } from '../http';

export type Parsed<T> = { ok: true; value: T } | { ok: false; response: Response };

const MAX_QUERY_VALUE_LENGTH = 200;

export function badQuery(message: string): Response {
  return agentError(400, 'invalid_query', message);
}

export function badId(message: string): Response {
  return agentError(400, 'invalid_id', message);
}

export function notFound(message: string): Response {
  return agentError(404, 'not_found', message);
}

/**
 * Reads the query string, allowing only `allowed` keys, each at most once, with values of at most
 * 200 characters. Unknown or repeated keys are a 400 `invalid_query`.
 */
export function parseQuery<K extends string>(request: Request, allowed: readonly K[]): Parsed<Partial<Record<K, string>>> {
  let params: URLSearchParams;
  try {
    params = new URL(request.url).searchParams;
  } catch {
    return { ok: false, response: badQuery('The request URL could not be parsed.') };
  }
  const allowedSet = new Set<string>(allowed);
  const out: Partial<Record<K, string>> = {};
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (!allowedSet.has(key)) {
      const list = allowed.length > 0 ? allowed.join(', ') : 'none';
      return { ok: false, response: badQuery(`Unknown query parameter "${key.slice(0, 40)}". Allowed: ${list}.`) };
    }
    if (seen.has(key)) return { ok: false, response: badQuery(`Query parameter "${key}" may appear only once.`) };
    seen.add(key);
    if (value.length > MAX_QUERY_VALUE_LENGTH) {
      return { ok: false, response: badQuery(`Query parameter "${key}" is too long.`) };
    }
    out[key as K] = value;
  }
  return { ok: true, value: out };
}

/** `YYYY-MM-DD` with a real calendar date; returns its parts or null. */
export function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** A positive integer path segment without sign, leading zeros or exponent (max 6 digits). */
export function parsePositiveIntParam(value: string): number | null {
  if (!/^[1-9]\d{0,5}$/.test(value)) return null;
  return Number(value);
}

/** Identifier shape used by catalog/database ids (`sched-row-12`, `row-3`, ...). */
export function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

/**
 * Runs a database read. Any thrown error becomes 500 `database_error` (logged by class and
 * SQLSTATE only); there is deliberately no fallback data source.
 */
export async function readFromDatabase<T>(label: string, read: () => Promise<T>): Promise<Parsed<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    console.error(`[agent-api] ${label} read failed: ${describeError(error)}`);
    return { ok: false, response: agentError(500, 'database_error', 'The database read failed.') };
  }
}
