/** Postgres SQLSTATE for "relation does not exist" (the agent migration has not been applied). */
export const PG_UNDEFINED_TABLE = '42P01';

/**
 * Returns the Postgres SQLSTATE of an error, following `cause` links (drizzle wraps driver errors
 * in `DrizzleQueryError`, whose message includes query params and must never be logged).
 */
export function pgErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function isUndefinedTableError(error: unknown): boolean {
  return pgErrorCode(error) === PG_UNDEFINED_TABLE;
}

/** Log-safe description: error class name and SQLSTATE only, never the message (it can hold values). */
export function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = pgErrorCode(error);
  return code ? `${name} (${code})` : name;
}
