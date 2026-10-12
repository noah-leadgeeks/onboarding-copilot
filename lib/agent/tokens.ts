import { createHash, randomBytes } from 'crypto';
import { AGENT_TOKEN_DISPLAY_PREFIX_LENGTH, AGENT_TOKEN_PREFIX } from './token-format';

export {
  AGENT_TOKEN_PREFIX,
  extractBearer,
  isValidTokenFormat,
  sanitizeTokenPrefix,
} from './token-format';

export interface GeneratedAgentToken {
  /** Plaintext; shown to the owner once and never stored. */
  token: string;
  /** sha256 hex of the plaintext; stored in `agent_tokens.token_hash`. */
  hash: string;
  /** `nova_agt_` + first 8 body characters; stored in `agent_tokens.token_prefix`. */
  prefix: string;
}

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateAgentToken(): GeneratedAgentToken {
  // 32 bytes -> exactly 43 base64url characters (no padding).
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashAgentToken(token), prefix: token.slice(0, AGENT_TOKEN_DISPLAY_PREFIX_LENGTH) };
}
