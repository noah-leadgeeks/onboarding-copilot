/**
 * Probation evaluation criteria, values assessment, and milestone checkpoints
 * aligned with the 'First Month Review', 'Second Month Review', and 'Third Month Review'
 * worksheets in the official HR workbook.
 */

export interface ReviewCriteriaItem {
  readonly id: string;
  readonly category: 'technical' | 'values' | 'goals';
  readonly title: string;
  readonly description: string;
  readonly scoreScale: '1-5';
}

export interface MonthlyReviewMilestone {
  readonly month: 1 | 2 | 3;
  readonly stageTitle: string;
  readonly targetDays: number;
  readonly focus: string;
  readonly technicalCriteria: readonly ReviewCriteriaItem[];
  readonly valuesCriteria: readonly ReviewCriteriaItem[];
}

export interface ReviewSelfAssessment {
  readonly month: 1 | 2 | 3;
  readonly achievements: string;
  readonly challenges: string;
  readonly goalsNextMonth: string;
  readonly updatedAt: string;
}

export const REVIEWS_STORAGE_KEY = 'nova-monthly-reviews';

export const HARPS_VALUES = [
  { key: 'honest', name: 'Honest', description: 'Integrity, transparency in communications, and genuine feedback.' },
  { key: 'adaptive', name: 'Adaptive', description: 'Flexibility in adopting new tools, workflows, and changing priorities.' },
  { key: 'responsible', name: 'Responsible', description: 'Strong ownership of deliverables, accountability for outcomes, and meeting SLAs.' },
  { key: 'punctual', name: 'Punctual', description: 'Timeliness in meetings, standups, and delivering sprint commitments.' },
  { key: 'solution-oriented', name: 'Solution-oriented', description: 'Proactive problem solving, critical thinking, and finding actionable fixes.' },
] as const;

export const OFFICIAL_MONTHLY_REVIEWS: readonly MonthlyReviewMilestone[] = [
  {
    month: 1,
    stageTitle: 'First Month Review (Day 30)',
    targetDays: 30,
    focus: 'Foundation & Core Understanding — Grasping systems, completing mandatory training, and initial task execution.',
    technicalCriteria: [
      {
        id: 'm1-tech-1',
        category: 'technical',
        title: 'System & Tool Familiarity',
        description: 'Demonstrates understanding of LeadGeeks IT environment, tools, platforms, and daily workflows.',
        scoreScale: '1-5',
      },
      {
        id: 'm1-tech-2',
        category: 'technical',
        title: 'Task Execution Quality',
        description: 'Completes assigned onboarding exercises and sprint tickets accurately with proper documentation.',
        scoreScale: '1-5',
      },
      {
        id: 'm1-tech-3',
        category: 'technical',
        title: 'Code/Configuration Standards',
        description: 'Adheres to security guidelines, SOPs, and departmental best practices.',
        scoreScale: '1-5',
      },
    ],
    valuesCriteria: [
      {
        id: 'm1-val-1',
        category: 'values',
        title: 'HARPS Alignment',
        description: 'Exhibits Honest, Adaptive, Responsible, Punctual, and Solution-oriented mindset in daily work.',
        scoreScale: '1-5',
      },
      {
        id: 'm1-val-2',
        category: 'values',
        title: 'Communication & Engagement',
        description: 'Participates actively in team standups, asks questions proactively, and communicates blockers early.',
        scoreScale: '1-5',
      },
    ],
  },
  {
    month: 2,
    stageTitle: 'Second Month Review (Day 60)',
    targetDays: 60,
    focus: 'Independence & Execution — Delivering real project deliverables with minimal supervision and consistent velocity.',
    technicalCriteria: [
      {
        id: 'm2-tech-1',
        category: 'technical',
        title: 'Autonomous Problem Solving',
        description: 'Diagnoses issues independently, proposes sound solutions, and implements fixes reliably.',
        scoreScale: '1-5',
      },
      {
        id: 'm2-tech-2',
        category: 'technical',
        title: 'Delivery Velocity & SLAs',
        description: 'Meets sprint commitments and deliverability deadlines consistently across projects.',
        scoreScale: '1-5',
      },
      {
        id: 'm2-tech-3',
        category: 'technical',
        title: 'Cross-Department Collaboration',
        description: 'Coordinates effectively with Operations, Growth, and FAC teams on cross-functional initiatives.',
        scoreScale: '1-5',
      },
    ],
    valuesCriteria: [
      {
        id: 'm2-val-1',
        category: 'values',
        title: 'Accountability & Initiative',
        description: 'Takes proactive ownership beyond assigned tickets to improve codebase and developer experience.',
        scoreScale: '1-5',
      },
      {
        id: 'm2-val-2',
        category: 'values',
        title: 'Receptiveness to Feedback',
        description: 'Applies mentor feedback promptly and demonstrates continuous learning agility.',
        scoreScale: '1-5',
      },
    ],
  },
  {
    month: 3,
    stageTitle: 'Third Month Review (Day 90)',
    targetDays: 90,
    focus: 'Leadership & Optimization — Full role autonomy, mentorship capability, and permanent employment readiness.',
    technicalCriteria: [
      {
        id: 'm3-tech-1',
        category: 'technical',
        title: 'Full Role Independence',
        description: 'Operates as a fully self-sufficient engineer/staff member handling end-to-end technical responsibilities.',
        scoreScale: '1-5',
      },
      {
        id: 'm3-tech-2',
        category: 'technical',
        title: 'Innovation & Process Optimization',
        description: 'Contributes to automation, documentation, or architecture enhancements that benefit the team.',
        scoreScale: '1-5',
      },
      {
        id: 'm3-tech-3',
        category: 'technical',
        title: 'Reliability & Excellence',
        description: 'Demonstrates rock-solid reliability, high-quality deliverables, and strong technical stewardship.',
        scoreScale: '1-5',
      },
    ],
    valuesCriteria: [
      {
        id: 'm3-val-1',
        category: 'values',
        title: 'Cultural Embodiment',
        description: 'Serves as an exemplar of LeadGeeks culture, supporting new peers and upholding team values.',
        scoreScale: '1-5',
      },
      {
        id: 'm3-val-2',
        category: 'values',
        title: 'Long-Term Strategic Alignment',
        description: 'Aligns personal career goals with the 2026 department roadmap and company vision.',
        scoreScale: '1-5',
      },
    ],
  },
];

/** Every review criteria id across all months (technical + values), for validating score maps. */
export const REVIEW_CRITERIA_IDS: readonly string[] = OFFICIAL_MONTHLY_REVIEWS.flatMap((m) =>
  [...m.technicalCriteria, ...m.valuesCriteria].map((c) => c.id)
);

export { STANDARD_SCORES } from './review-scoring';

export function readReviewAssessments(raw: string | null): ReviewSelfAssessment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ReviewSelfAssessment =>
        Boolean(item) &&
        typeof item === 'object' &&
        (item.month === 1 || item.month === 2 || item.month === 3)
    );
  } catch {
    return [];
  }
}

export function writeReviewAssessments(items: ReviewSelfAssessment[]): string {
  return JSON.stringify(items);
}

export function upsertReviewAssessment(
  items: ReviewSelfAssessment[],
  nextItem: ReviewSelfAssessment
): ReviewSelfAssessment[] {
  const index = items.findIndex((i) => i.month === nextItem.month);
  if (index >= 0) {
    const copy = [...items];
    copy[index] = nextItem;
    return copy;
  }
  return [...items, nextItem];
}

export function clipboardRowForReview(
  milestone: MonthlyReviewMilestone,
  assessment?: ReviewSelfAssessment,
  scores?: Record<string, number>
): string {
  const achievements = (assessment?.achievements || '').replace(/[\t\r\n]+/g, ' ').trim();
  const challenges = (assessment?.challenges || '').replace(/[\t\r\n]+/g, ' ').trim();
  const goals = (assessment?.goalsNextMonth || '').replace(/[\t\r\n]+/g, ' ').trim();
  const scoreValues = scores ? Object.values(scores).filter((s) => typeof s === 'number' && s > 0) : [];
  const avg = scoreValues.length > 0 ? (scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(1) : '-';

  return [
    `Month ${milestone.month}`,
    milestone.stageTitle,
    milestone.focus,
    achievements,
    challenges,
    goals,
    avg,
  ].join('\t');
}

