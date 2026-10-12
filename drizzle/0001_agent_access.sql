-- Migration 0001_agent_access: agent_tokens, agent_proposals, agent_audit_log (additive, forward-only).
--
-- DEPLOY ORDER: vercel.json has no migrate hook. Run `pnpm db:migrate "$URL"` against the
-- remote database BEFORE deploying any application code that references these tables.
--
-- If the remote is not baselined yet, do the docs/DATABASE.md baseline first, then db:migrate.
--
-- MANUAL ROLLBACK (last resort, forward-only policy; UNRECOVERABLE):
--   Rollback destroys all agent tokens, the audit log AND all proposals: pending ones plus the
--   before/result history, which is the only record of what agents changed.
--   1. Revert the application code that references the three tables first.
--   2. Run in one transaction:
--        BEGIN;
--        DROP TABLE agent_audit_log;
--        DROP TABLE agent_proposals;
--        DROP TABLE agent_tokens;
--        DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1791814439552;
--        COMMIT;
--   3. lib/db/schema.ts, drizzle/0001_agent_access.sql, its entry in drizzle/meta/_journal.json
--      and drizzle/meta/0001_snapshot.json must be reverted together as one set; otherwise the
--      next `pnpm db:migrate` re-creates the tables.
--
CREATE TABLE "agent_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"token_id" text,
	"token_prefix" text,
	"user_email" text,
	"action" text NOT NULL,
	"proposal_id" text,
	"method" text,
	"path" text,
	"status_code" integer,
	"duration_ms" integer,
	"details" jsonb,
	CONSTRAINT "agent_audit_log_actor_chk" CHECK ("agent_audit_log"."actor" IN ('agent', 'user', 'system'))
);
--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"token_id" text NOT NULL,
	"domain" text NOT NULL,
	"operation" text NOT NULL,
	"target_table" text NOT NULL,
	"target_key" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"before" jsonb,
	"expected_updated_at" text,
	"refreshed_at" timestamp with time zone,
	"ratings_source" text,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"body_hash" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	CONSTRAINT "agent_proposals_token_idem_uq" UNIQUE("token_id","idempotency_key"),
	CONSTRAINT "agent_proposals_operation_chk" CHECK ("agent_proposals"."operation" IN ('update', 'delete')),
	CONSTRAINT "agent_proposals_status_chk" CHECK ("agent_proposals"."status" IN ('pending', 'executed', 'failed', 'rejected', 'cancelled', 'expired')),
	CONSTRAINT "agent_proposals_ratings_source_chk" CHECK ("agent_proposals"."ratings_source" IS NULL OR "agent_proposals"."ratings_source" IN ('user-dictated'))
);
--> statement-breakpoint
CREATE TABLE "agent_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "agent_tokens_scopes_array_chk" CHECK (jsonb_typeof("agent_tokens"."scopes") = 'array')
);
--> statement-breakpoint
ALTER TABLE "agent_audit_log" ADD CONSTRAINT "agent_audit_log_token_id_agent_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."agent_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_audit_log" ADD CONSTRAINT "agent_audit_log_proposal_id_agent_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."agent_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_token_id_agent_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."agent_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_audit_log_token_created_idx" ON "agent_audit_log" USING btree ("token_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_audit_log_created_idx" ON "agent_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_status_expires_idx" ON "agent_proposals" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "agent_proposals_token_created_idx" ON "agent_proposals" USING btree ("token_id","created_at");