/**
 * Edge-safe token shape helpers (no Node `crypto` import), so middleware can share them.
 * Plaintext format: `nova_agt_` + 43 base64url characters (32 random bytes).
 */
export const AGENT_TOKEN_PREFIX = 'nova_agt_';
export const AGENT_TOKEN_BODY_LENGTH = 43;
/** `nova_agt_` plus the first 8 body characters; also the max stored `token_prefix` length. */
export const AGENT_TOKEN_DISPLAY_PREFIX_LENGTH = AGENT_TOKEN_PREFIX.length + 8;

const TOKEN_PATTERN = new RegExp(`^${AGENT_TOKEN_PREFIX}[A-Za-z0-9_-]{${AGENT_TOKEN_BODY_LENGTH}}$`);

export function isValidTokenFormat(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/**
 * Reduces an untrusted, possibly malformed bearer value to something safe to store in
 * `agent_audit_log.token_prefix`: only `[A-Za-z0-9_]`, at most 17 characters. Never the full token.
 */
export function sanitizeTokenPrefix(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.slice(0, AGENT_TOKEN_DISPLAY_PREFIX_LENGTH).replace(/[^A-Za-z0-9_]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/** Extracts the bearer value from an `Authorization` header, or null when absent or not Bearer. */
export function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}
