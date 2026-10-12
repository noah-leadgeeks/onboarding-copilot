# ADR-0007: Agent API and Approval Boundary

**Status:** Proposed
**Date:** 2026-10-12
**Deciders:** Engineering, Product

> This ADR is a proposal. It is not accepted, and nothing in the codebase may rely on it until the status changes to Accepted. It depends on [ADR-0006](0006-database-working-copy-and-sync-conflicts.md), which is also Proposed.

---

## Context

The user runs a personal agent (OpenClaw) and wants it to read onboarding data (today's tasks, schedule, diary, feedback, reviews, timeline, glossary, session history) and to suggest updates. [ADR-0003](0003-ai-is-assistive-not-authoritative.md) says AI output is assistive and that nothing AI-generated is persisted without explicit user confirmation. The repository rules in `AGENTS.md` say AI output is untrusted input.

What existed before this change:

- One cookie gate in `middleware.ts`. There was no inbound service credential anywhere in `app/` or `lib/`.
- No owner check. `app/api/auth/callback/google/route.ts` creates a session for whatever Google account completes OAuth. Only the OAuth consent-screen configuration keeps strangers out.
- Existing write routes (`/api/diary`, `/api/sheets/update-cell`, ...) have Sheets side effects, unvalidated bodies and no pending concept, so they are not safe to hand to an agent.
- OpenClaw's own documentation states that its exec approvals are not a per-user auth boundary, and the agent can be prompt-injected. The approval therefore cannot live in OpenClaw.

## Decision

**1. Agent tokens.** The agent authenticates with `Authorization: Bearer nova_agt_...` under `/api/agent/v1/*` only. Tokens are minted by the owner in Settings (AI agent access), shown once, stored as a sha256 hash (`agent_tokens`), scoped (`<domain>:read`, `<domain>:propose`, `glossary:read`, `sessions:read`), expiring (default 90 days) and revocable. Middleware lets `/api/agent/` through on header shape only (edge runtime, no database); the real check is `withAgentRoute` in `lib/agent/auth.ts`, and a guard test fails the build if a route under `app/api/agent/` is not wrapped. Every other path stays cookie-only and admin routes reject any `Authorization` header.

**2. Propose/approve boundary.** The agent can only read and create proposals (`agent_proposals`). No scope executes anything. Execution happens only in an owner-session endpoint, `POST /api/agent-admin/proposals/:id/approve`, in one database transaction that re-checks expiry, token revocation, warning acknowledgement, and staleness (the target row's `updated_at` compared in SQL against the value the owner saw). Revoking a token cancels its pending proposals; approving a proposal whose token was revoked in the meantime returns 409 `token_revoked` and marks it `cancelled`. Failed or stale executions never partially apply. Deletes are limited to a diary entry (reset to catalog defaults), a feedback entry and a monthly review; schedule activities, catalog rows and `session_logs` cannot be deleted.

This satisfies ADR-0003 ("explicit confirmation before persisting") and the `AGENTS.md` AI rules: the approval screen shows the full `before` and `changes`, the reason, any warnings and the token name, and the owner's click is the confirmation.

**3. Database-only execution (D2).** The executor writes PostgreSQL only and never writes to Google Sheets. Agent-executed changes reach the spreadsheet only when the user runs the existing bulk sync. No sync code was changed. The agent API is available only in database mode: without `DATABASE_URL` every agent route answers 503 `agent_api_requires_database`.

**4. App login relies on the Google OAuth consent-screen restriction, not on code (D6).** There is no application-wide login allowlist. Today only the consent-screen configuration (Testing mode or a Workspace-restricted app) keeps other Google accounts out. **Publishing the OAuth app to external users would let anyone sign in**, and from there they could use every cookie-gated route. `AGENT_ADMIN_EMAILS` (comma-separated, case-insensitive, fail-closed when unset) is **defense in depth for the admin routes only** (`lib/agent/admin-auth.ts`): it protects token minting, revocation, approval and rejection, not the rest of the app. The owner accepted this scope. `AUTH_SECRET` must be set in production, because the key-derivation fallback in `lib/auth/crypto.ts` is a hardcoded string, and `AUTH_DISABLED` must never be set in production; admin routes refuse to work in either case (503).

**5. `ratingsSource` is self-asserted.** Ratings (feedback `ratings`, review `technicalRatings` and `valuesRatings`) are proposable only when the proposal carries `ratingsSource: 'user-dictated'`. The agent sets that field itself and the server cannot verify it. The actual ADR-0003 control is the owner reading the flagged diff and the callout on the approval card before approving. Formula-like text (starting with `=`, `+`, `-`, `@`, tab or CR) is accepted but flagged with `warnings: ['formula_like:<field>']` and needs an explicit acknowledgement checkbox.

**6. Audit.** `agent_audit_log` records one row per agent request (reserved before the handler, finalized with status and duration) and one row per owner decision. Actions: `read.<domain>`, `propose.<domain>.<operation>`, `cancel`, `approve`, `reject`, `auth.failed` (capped at 20 rows per minute), `insufficient_scope`, `rate_limited`, `token.issue`, `token.revoke`. It never stores token values, payload text or query strings. Retention is not implemented (see `docs/TODO.md`).

**7. Limits.** Defaults, all overridable by environment variable: 60 reads per minute, 10 proposals per minute, 20 pending proposals, 24 hour proposal expiry, 90 day token expiry. Rate limiting is best-effort (count then act, no lock), which is acceptable for one user.

## Consequences

### Positive

- The agent holds a revocable, scoped, least-privilege credential and cannot change data on its own.
- The approval, staleness check and audit are enforced by the server, not by OpenClaw.
- Zero new runtime dependencies; plain REST that can be tested with curl. An MCP adapter can later wrap the same `lib/agent/*` functions.

### Negative and caveats

- **Browser overlays (S12).** Pages keep localStorage copies and save whole rows. A browser tab opened before an agent change executes can overwrite that change on its next save. The agent API cannot see browser-only data (quick notes, schedule customizations, imported schedules, pending session syncs), so the agent's `/today` is the database view only and never falls back to the Sheets proxy or the hardcoded catalog.
- **Bulk sync pushes agent edits.** Agent-executed rows are not marked "unsynced". The bulk sync pushes DB values, which may already include agent edits, and does so with `USER_ENTERED` (ADR-0006 follow-up 5), so formula-like text can reach the sheet as a formula. The mitigation here is the proposal warning; the real fix is a sync change that needs its own plan.
- Any Google account that can sign in can use the non-admin cookie routes (see decision 4).
- Rollback is lossy: see Deploy and rollback.

## Deploy and rollback

Migration `drizzle/0001_agent_access.sql` adds three tables (`agent_tokens`, `agent_proposals`, `agent_audit_log`) and is forward-only.

1. The user runs `pnpm db:migrate "$URL"` against the remote database **before** deploying the application code. `vercel.json` has no migrate hook. Until the migration runs, agent routes answer 503 `agent_tables_missing`, and the Settings card and the nav badge degrade quietly (no thrown error).
2. If the remote database was created by the old seed script and is not baselined yet, do the baseline procedure in [`docs/DATABASE.md`](../DATABASE.md#existing-remote-database-created-by-the-old-seed-script-user-run-only) first; `db:migrate` fails on an un-baselined database because it would try to recreate the existing tables. Agents never connect to the remote database.
3. Rollback (last resort): revert the application code first, then run the manual SQL in the header of `drizzle/0001_agent_access.sql`. It **permanently destroys all agent tokens, all proposals (including the before and result history, the only record of what the agent changed) and the audit log.** Revert `lib/db/schema.ts`, the `.sql` file, `drizzle/meta/_journal.json` and `drizzle/meta/0001_snapshot.json` together.

## Revisit When

- The OAuth app is or may be published beyond the owner's account or organization (an app-wide allowlist becomes mandatory).
- More than one person uses the app, or a second agent needs different scopes.
- Sync gains per-row markers (ADR-0006 follow-ups): agent edits should then show as unsynced, and `RAW` writes should replace `USER_ENTERED`.
- An MCP adapter or an inbound wake hook replaces the curl-based skill.
