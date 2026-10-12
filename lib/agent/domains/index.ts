/** Registry of proposable domains (plan Step 6). Read-only domains (glossary, sessions, today) are absent. */
import { diaryDomain } from './diary';
import { feedbackDomain } from './feedback';
import { reviewsDomain } from './reviews';
import { scheduleDomain } from './schedule';
import { timelineDomain } from './timeline';
import { PROPOSAL_DOMAINS, type DomainModule, type ProposalDomain } from './types';

export const DOMAINS: Readonly<Record<ProposalDomain, DomainModule>> = {
  schedule: scheduleDomain,
  diary: diaryDomain,
  feedback: feedbackDomain,
  reviews: reviewsDomain,
  timeline: timelineDomain,
};

export function isProposalDomain(value: unknown): value is ProposalDomain {
  return typeof value === 'string' && (PROPOSAL_DOMAINS as readonly string[]).includes(value);
}

export function getDomain(value: unknown): DomainModule | null {
  return isProposalDomain(value) ? DOMAINS[value] : null;
}

export * from './types';
