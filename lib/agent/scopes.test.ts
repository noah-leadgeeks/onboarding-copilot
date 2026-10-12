import { hasScope, parseScopes, SCOPES } from './scopes';

describe('lib/agent/scopes', () => {
  it('lists read and propose scopes for writable domains and read-only glossary/sessions', () => {
    expect(SCOPES).toContain('diary:propose');
    expect(SCOPES).toContain('glossary:read');
    expect(SCOPES).toContain('sessions:read');
    expect(SCOPES.includes('glossary:propose' as never)).toBe(false);
    expect(SCOPES.includes('proposals:read' as never)).toBe(false);
    expect(new Set(SCOPES).size).toBe(SCOPES.length);
  });

  it('parses, de-duplicates and orders scopes; rejects anything else', () => {
    expect(parseScopes(['diary:propose', 'diary:read', 'diary:read'])).toEqual(['diary:read', 'diary:propose']);
    expect(parseScopes([])).toBeNull();
    expect(parseScopes(['diary:read', 'admin'])).toBeNull();
    expect(parseScopes(['proposals:read'])).toBeNull();
    expect(parseScopes('diary:read')).toBeNull();
    expect(parseScopes([1])).toBeNull();
    expect(parseScopes(null)).toBeNull();
  });

  it('checks concrete, wildcard and implied scopes', () => {
    expect(hasScope(['diary:read'], 'diary:read')).toBe(true);
    expect(hasScope(['diary:read'], 'diary:propose')).toBe(false);
    expect(hasScope(['diary:propose'], 'diary:read')).toBe(false);
    expect(hasScope([], 'any')).toBe(true);
    expect(hasScope(['diary:read'], 'any-propose')).toBe(false);
    expect(hasScope(['feedback:propose'], 'any-propose')).toBe(true);
    expect(hasScope(['feedback:propose'], 'proposals:read')).toBe(true);
    expect(hasScope(['diary:read'], 'proposals:read')).toBe(false);
    expect(hasScope(['diary:read'], 'unknown:read')).toBe(false);
    expect(hasScope(['admin'], 'admin')).toBe(false);
  });
});
