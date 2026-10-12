/**
 * Agent token scopes: `<domain>:read` and `<domain>:propose`. No scope executes anything;
 * `proposals:read` is implied by any `:propose` scope and is not issued directly.
 */
export const SCOPES = [
  'schedule:read',
  'schedule:propose',
  'diary:read',
  'diary:propose',
  'feedback:read',
  'feedback:propose',
  'reviews:read',
  'reviews:propose',
  'timeline:read',
  'timeline:propose',
  'glossary:read',
  'sessions:read',
] as const;

export type AgentScope = (typeof SCOPES)[number];

/** A requirement passed to `hasScope`: a concrete scope, the implied `proposals:read`, or a wildcard. */
export type ScopeRequirement = AgentScope | 'proposals:read' | 'any' | 'any-propose';

const SCOPE_SET: ReadonlySet<string> = new Set(SCOPES);

export function isAgentScope(value: unknown): value is AgentScope {
  return typeof value === 'string' && SCOPE_SET.has(value);
}

/**
 * Parses a scope list (issuance input or the stored jsonb). Returns the de-duplicated scopes in
 * canonical order, or null when the value is not a non-empty array of known scope strings.
 */
export function parseScopes(value: unknown): AgentScope[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set<string>();
  for (const item of value) {
    if (!isAgentScope(item)) return null;
    seen.add(item);
  }
  return SCOPES.filter((scope) => seen.has(scope));
}

export function hasScope(granted: readonly string[], required: string): boolean {
  if (required === 'any') return true;
  const hasAnyPropose = granted.some((scope) => isAgentScope(scope) && scope.endsWith(':propose'));
  if (required === 'any-propose') return hasAnyPropose;
  if (required === 'proposals:read') return hasAnyPropose || granted.includes('proposals:read');
  return isAgentScope(required) && granted.includes(required);
}
