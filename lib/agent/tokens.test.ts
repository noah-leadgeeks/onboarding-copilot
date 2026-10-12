import { extractBearer, generateAgentToken, hashAgentToken, isValidTokenFormat, sanitizeTokenPrefix } from './tokens';

describe('lib/agent/tokens', () => {
  it('generates nova_agt_ + 43 base64url chars with a matching hash and 17-char prefix', () => {
    const { token, hash, prefix } = generateAgentToken();
    expect(token).toMatch(/^nova_agt_[A-Za-z0-9_-]{43}$/);
    expect(isValidTokenFormat(token)).toBe(true);
    expect(hash).toBe(hashAgentToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(prefix).toBe(token.slice(0, 17));
    expect(prefix).toHaveLength(17);
  });

  it('generates distinct tokens', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateAgentToken().token));
    expect(seen.size).toBe(50);
  });

  it('hashes deterministically with sha256', () => {
    expect(hashAgentToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('rejects malformed tokens', () => {
    const valid = generateAgentToken().token;
    for (const bad of ['', 'nova_agt_', `${valid}x`, valid.slice(0, -1), `NOVA_AGT_${valid.slice(9)}`, `nova_agt_${'!'.repeat(43)}`, ` ${valid}`]) {
      expect(isValidTokenFormat(bad)).toBe(false);
    }
    expect(isValidTokenFormat(undefined)).toBe(false);
    expect(isValidTokenFormat(42)).toBe(false);
  });

  it('extracts bearer values', () => {
    expect(extractBearer('Bearer abc')).toBe('abc');
    expect(extractBearer('bearer   abc  ')).toBe('abc');
    expect(extractBearer('Basic abc')).toBeNull();
    expect(extractBearer('Bearer a b')).toBeNull();
    expect(extractBearer(null)).toBeNull();
  });

  it('sanitizes prefixes to [A-Za-z0-9_] and at most 17 chars', () => {
    expect(sanitizeTokenPrefix('nova_agt_abcdefghijklmnop')).toBe('nova_agt_abcdefgh');
    expect(sanitizeTokenPrefix('<>"\'')).toBeNull();
    expect(sanitizeTokenPrefix(null)).toBeNull();
  });
});
