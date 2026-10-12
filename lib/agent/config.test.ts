import { AGENT_CONFIG_DEFAULTS, getAgentConfig } from './config';

const KEYS = [
  'AGENT_RATE_LIMIT_READS_PER_MIN',
  'AGENT_RATE_LIMIT_PROPOSALS_PER_MIN',
  'AGENT_MAX_PENDING_PROPOSALS',
  'AGENT_PROPOSAL_TTL_HOURS',
  'AGENT_TOKEN_DEFAULT_TTL_DAYS',
] as const;

describe('lib/agent/config', () => {
  const saved = new Map<string, string | undefined>();
  beforeAll(() => KEYS.forEach((k) => saved.set(k, process.env[k])));
  beforeEach(() => KEYS.forEach((k) => delete process.env[k]));
  afterAll(() => {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('uses the D4 defaults', () => {
    expect(getAgentConfig()).toEqual({
      readsPerMin: 60,
      proposalsPerMin: 10,
      maxPending: 20,
      proposalTtlHours: 24,
      tokenDefaultTtlDays: 90,
    });
    expect(getAgentConfig()).toEqual({ ...AGENT_CONFIG_DEFAULTS });
  });

  it('reads positive integers from the environment', () => {
    process.env.AGENT_RATE_LIMIT_READS_PER_MIN = '5';
    process.env.AGENT_RATE_LIMIT_PROPOSALS_PER_MIN = ' 3 ';
    process.env.AGENT_MAX_PENDING_PROPOSALS = '7';
    process.env.AGENT_PROPOSAL_TTL_HOURS = '48';
    process.env.AGENT_TOKEN_DEFAULT_TTL_DAYS = '30';
    expect(getAgentConfig()).toEqual({ readsPerMin: 5, proposalsPerMin: 3, maxPending: 7, proposalTtlHours: 48, tokenDefaultTtlDays: 30 });
  });

  it('falls back on invalid values', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '', '99999999999999999999']) {
      process.env.AGENT_RATE_LIMIT_READS_PER_MIN = bad;
      expect(getAgentConfig().readsPerMin).toBe(60);
    }
  });
});
