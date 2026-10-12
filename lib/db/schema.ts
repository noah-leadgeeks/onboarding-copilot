import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  bigint,
  check,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const activities = pgTable('activities', {
  id: text('id').primaryKey(),
  rowNumber: integer('row_number').notNull(),
  week: text('week').notNull(),
  day: text('day').notNull(),
  date: text('date').notNull(),
  activityCount: integer('activity_count'),
  pic: text('pic').notNull(),
  topic: text('topic').notNull(),
  mainMedia: text('main_media').notNull(),
  durationMinutes: integer('duration_minutes'),
  startTime: text('start_time'),
  endTime: text('end_time'),
  progress: text('progress').default(''),
  materialsLink: text('materials_link').default(''),
  notes: text('notes').default(''),
  actualStart: text('actual_start'),
  actualEnd: text('actual_end'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const diaryTopics = pgTable('diary_topics', {
  id: text('id').primaryKey(),
  rowNumber: integer('row_number').notNull(),
  day: text('day').notNull(),
  week: text('week').notNull(),
  date: text('date').notNull(),
  activityCount: text('activity_count'),
  pic: text('pic').notNull(),
  topic: text('topic').notNull(),
  defaultLearned: text('default_learned'),
  defaultNotes: text('default_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const diaryEntries = pgTable('diary_entries', {
  id: text('id').primaryKey(),
  rowNumber: integer('row_number').notNull().unique(),
  learned: text('learned').notNull().default(''),
  notes: text('notes').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});

export const feedbackSessions = pgTable('feedback_sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  topic: text('topic').notNull(),
  pic: text('pic').notNull(),
  rowNumber: integer('row_number').notNull(),
  department: text('department').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const feedbackEntries = pgTable('feedback_entries', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().unique(),
  rowNumber: integer('row_number').notNull(),
  date: text('date'),
  pic: text('pic'),
  topic: text('topic'),
  ratings: jsonb('ratings'),
  hasQuestions: boolean('has_questions').default(false),
  questionExplanation: text('question_explanation').default(''),
  questionAddressing: text('question_addressing').default(''),
  suggestions: text('suggestions').default(''),
  updatedAt: text('updated_at').notNull(),
});

export const timelineStages = pgTable('timeline_stages', {
  id: text('id').primaryKey(),
  stageNumber: text('stage_number').notNull(),
  stageName: text('stage_name').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  objective: text('objective').notNull(),
  keyActivities: text('key_activities').notNull(),
  outputsEvidence: text('outputs_evidence').notNull(),
  minimumDuration: text('minimum_duration').notNull(),
  completedEvidence: jsonb('completed_evidence'),
  updatedAt: text('updated_at'),
});

export const monthlyReviews = pgTable('monthly_reviews', {
  id: text('id').primaryKey(),
  month: integer('month').notNull().unique(),
  achievements: text('achievements').notNull().default(''),
  challenges: text('challenges').notNull().default(''),
  goalsNextMonth: text('goals_next_month').notNull().default(''),
  technicalRatings: jsonb('technical_ratings'),
  valuesRatings: jsonb('values_ratings'),
  updatedAt: text('updated_at').notNull(),
});

export const trainingModules = pgTable('training_modules', {
  id: text('id').primaryKey(),
  topic: text('topic').notNull(),
  pic: text('pic').notNull(),
  objectives: text('objectives').notNull(),
  frameworkMaterials: text('framework_materials').notNull(),
  materials: text('materials').notNull(),
  media: text('media').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  materialAccess: text('material_access'),
  materialLinks: jsonb('material_links'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const sessionLogs = pgTable('session_logs', {
  id: text('id').primaryKey(),
  activityId: text('activity_id').notNull(),
  name: text('name').notNull(),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  finishedAt: bigint('finished_at', { mode: 'number' }).notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentTokens = pgTable(
  'agent_tokens',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    scopes: jsonb('scopes').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [check('agent_tokens_scopes_array_chk', sql`jsonb_typeof(${t.scopes}) = 'array'`)]
);

export const agentProposals = pgTable(
  'agent_proposals',
  {
    id: text('id').primaryKey(),
    tokenId: text('token_id')
      .notNull()
      .references(() => agentTokens.id),
    domain: text('domain').notNull(),
    operation: text('operation').notNull(),
    targetTable: text('target_table').notNull(),
    targetKey: jsonb('target_key').notNull(),
    changes: jsonb('changes').notNull(),
    // SQL NULL means the target row did not exist at the last check.
    before: jsonb('before'),
    expectedUpdatedAt: text('expected_updated_at'),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }),
    ratingsSource: text('ratings_source'),
    warnings: jsonb('warnings').notNull().default(sql`'[]'::jsonb`),
    reason: text('reason').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    bodyHash: text('body_hash').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    result: jsonb('result'),
  },
  (t) => [
    check('agent_proposals_operation_chk', sql`${t.operation} IN ('update', 'delete')`),
    check(
      'agent_proposals_status_chk',
      sql`${t.status} IN ('pending', 'executed', 'failed', 'rejected', 'cancelled', 'expired')`
    ),
    check(
      'agent_proposals_ratings_source_chk',
      sql`${t.ratingsSource} IS NULL OR ${t.ratingsSource} IN ('user-dictated')`
    ),
    unique('agent_proposals_token_idem_uq').on(t.tokenId, t.idempotencyKey),
    index('agent_proposals_status_expires_idx').on(t.status, t.expiresAt),
    index('agent_proposals_token_created_idx').on(t.tokenId, t.createdAt),
  ]
);

export const agentAuditLog = pgTable(
  'agent_audit_log',
  {
    id: text('id').primaryKey(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    actor: text('actor').notNull(),
    tokenId: text('token_id').references(() => agentTokens.id),
    tokenPrefix: text('token_prefix'),
    userEmail: text('user_email'),
    action: text('action').notNull(),
    proposalId: text('proposal_id').references(() => agentProposals.id),
    method: text('method'),
    path: text('path'),
    statusCode: integer('status_code'),
    durationMs: integer('duration_ms'),
    details: jsonb('details'),
  },
  (t) => [
    check('agent_audit_log_actor_chk', sql`${t.actor} IN ('agent', 'user', 'system')`),
    index('agent_audit_log_token_created_idx').on(t.tokenId, t.createdAt),
    index('agent_audit_log_created_idx').on(t.createdAt),
  ]
);
