# Architecture

**Product:** NOVA (Newcomer Onboarding & Virtual Assistant)
**Status:** Active — MVP
**Last updated:** 2026-09-05

---

## 1. Architectural Principle

> The application is a convenience layer on top of the existing Google Sheets onboarding system.

Google Sheets remains the source of truth during MVP. The application does not own the data — it reads, transforms, and writes back to the sheet on behalf of the employee.

See: [`docs/adr/0001-google-sheets-as-source-of-truth.md`](adr/0001-google-sheets-as-source-of-truth.md)

---

## 2. High-Level Architecture

```
                    ┌─────────────────┐
                    │  Google Sheets  │
                    │ Source of Truth │
                    └────────┬────────┘
                             │
                         Sheets API
                             │
                             ▼
┌──────────────┐      ┌──────────────┐
│              │      │              │
│   Web App    │◄────►│  Application │
│  (Next.js)   │      │  API Routes  │
│              │      │              │
└──────────────┘      └──────┬───────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
              AI Service            n8n
                    │                │
                    │                ├── reminders
                    │                ├── summaries
                    │                └── automation
                    ▼
          Structured Output
          (user-confirmed)
```

---

## 3. Recommended Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js (App Router) | Server components where possible |
| Language | TypeScript (strict) | Required |
| Styling | Tailwind CSS | |
| Backend | Next.js API Routes | No separate server for MVP |
| Auth | Google OAuth 2.0 | Via NextAuth.js or similar |
| Integration | Google Sheets API v4 | |
| Automation | n8n | Non-critical path only |
| AI | Provider-agnostic LLM API | Abstracted behind a service interface |
| Database | None (MVP) | Google Sheets is the store |
| Cache | None (MVP) | Add if API rate limits become an issue |

---

## 4. Data Ownership

### Google Sheets owns:

- Schedule (activities, planned times, dates)
- Onboarding Diary (learning entries)
- Feedback Sheet
- Timeline / progress tracking
- Glossary / reference information

### The application owns:

- Temporary session state (in-progress timer)
- UI state
- AI processing state (pre-confirmation drafts)
- Local learning records (diary entries and quick notes with structured metadata in browser storage; the structured metadata is local-only per [ADR-0005](adr/0005-learning-records-and-ai-provider-chain.md))
- Integration metadata (sync status, last sync timestamp)
- Pending writes (when Sheets is temporarily unavailable)

---

## 5. Data Flows

### Schedule — Read

```
Google Sheets
  → Sheets API (read)
  → API Route: GET /api/schedule
  → Today view (filtered by date)
```

### Schedule — Import (local-first alternative source)

```
User picks a file in Settings (.xlsx / .csv / .tsv, ≤ 2 MB)
  → API Route: POST /api/import (multipart)
  → lib/import/ parses + validates rows into Activity[]
  → Preview with explicit user confirmation
  → Persisted to localStorage (onboarding-imported-schedule)
  → Today and Learnings prefer the imported schedule over the demo fallback
```

The file is parsed server-side and never leaves the user's device afterward. Parsing uses `fflate` (ZIP container) + `fast-xml-parser` (sheet XML) — no SheetJS dependency. All parsed rows are validated at the boundary (`isActivity`) before entering the app.

### Session — Start

```
User taps Start
  → Application records start timestamp (local)
  → Activity status → In Progress
  → UI shows live timer
```

### Session — Finish

```
User taps Finish
  → Application records end timestamp
  → Duration calculated
  → API Route: PATCH /api/schedule/:activityId
  → Sheets API (write): actual start, actual end, duration, status → Done
```

### Learning Capture

```
User finishes an activity (or writes a quick note)
  → LearningModal (accessible dialog: focus trap, Esc to dismiss) collects typed notes
  → Optional "Summarize for me" → POST /api/ai/summarize
  → Server resolves the AI provider deterministically (ADR-0005):
     fully configured Groq first, generic OpenAI-compatible endpoint second,
     deterministic local heuristic when neither is configured or the call fails
  → AI summary presented as an editable draft; the user must review and
    explicitly confirm it before saving (ADR-0003); editing resets confirmation
  → Save → structured local diary record in browser storage
     (optional id, activity identity, source, updatedAt; legacy
     {content, createdAt} records stay accepted and gain a derived
     stable ID at read time)
  → POST /api/diary with exactly { content }; structured fields never
     leave the device (diarySyncPayload in lib/learning-capture)
  → Sheets write: when the diary proxy is configured, the server forwards
     the content to the Onboarding Diary (row timestamp stamped server-side);
     otherwise the note stays local with syncStatus "pending"
```

### Learnings: Manage and Export

```
Diary entries and quick notes (browser storage, validated at the boundary)
  → Read-only views with resolved stable IDs (derived for legacy records)
  → Filter by search text, source (manual / quick-note / AI-assisted /
    legacy), and activity (lib/learning-records-view)
  → Explicit user actions only: inline diary edit (stamps updatedAt,
    keeps createdAt), two-step delete (confirmation step), and
    quick-note → diary conversion preserving the original timestamp
  → Export selected notes from the filtered list as deterministic CSV
    (RFC4180, UTF-8 BOM, metadata columns) or Markdown (UTC headings and
    metadata) via client-side Blob download; record IDs are never exported
```

### Automation

```
Application event (e.g., session completed)
  → Webhook: POST to n8n
  → n8n workflow triggered
  → Notification / summary / external integration
```

---

## 6. Module Boundaries

```
app/                  Next.js pages and layouts
app/api/              API routes (server-only)
  ├── schedule/       Read and update schedule activities
  ├── import/         Parse uploaded schedule files (.xlsx/.csv/.tsv)
  ├── diary/          Diary sync boundary (accepts exactly { content })
  ├── session/        Session state management
  ├── ai/             AI processing endpoints
  ├── agent/          Agent API (bearer token, DB mode only): reads and proposals, `/api/agent/v1/*`
  └── agent-admin/    Owner-only token, approval and audit routes (cookie session + AGENT_ADMIN_EMAILS)

lib/
  ├── sheets/         Google Sheets API client (isolated)
  ├── import/         Uploaded-file parsing (CSV + XLSX → string matrix → Activity[])
  ├── ai/             AI provider resolution + clients (Groq → generic → local heuristic; provider-agnostic)
  ├── local-records   Local session/diary/quick-note storage: boundary validation, stable IDs, edit/delete/convert
  ├── learning-*      Capture projection ({ content } sync payload), Learnings filters and views, modal draft state
  ├── export-notes    Deterministic CSV/Markdown note serialization
  ├── n8n/            n8n webhook client
  ├── agent/          Agent tokens, scopes, auth wrapper, audit, rate limit, read projections, proposal domains, approvals
  └── session/        Session business logic

components/           React components (UI only, no API calls)
```

> Integration code (`lib/sheets/`, `lib/ai/`, `lib/n8n/`) must remain isolated from business logic. Swap implementations without touching business code.

---

## 7. Failure Strategy

### If Google Sheets API is unavailable:

- Do not lose session data.
- Persist session state locally (in-memory or localStorage with a clear pending indicator).
- Retry synchronization with exponential backoff.
- Show synchronization status clearly in the UI.
- Never silently discard a completed session.

### If the AI service is unavailable:

- Provider resolution is server-side and deterministic ([ADR-0005](adr/0005-learning-records-and-ai-provider-chain.md)): a fully configured Groq provider first, a fully configured generic OpenAI-compatible endpoint second. Partially configured providers are skipped, never guessed into service.
- When no provider is configured or the provider call fails, the summarize endpoint returns a deterministic local heuristic summary (the note itself, truncated) and capture stays fully manual.
- Never block completion of an onboarding activity because AI is down.
- AI summarization is an enhancement, not a requirement.

### If n8n is unavailable:

- Core application remains fully functional.
- Automation tasks (notifications, summaries) are best-effort only.
- Log failed webhook calls for manual retry if needed.

---

## 8. Security Considerations

- Google OAuth tokens stored server-side only (never exposed to the client).
- All Sheets API calls made from API routes (server-side), never from client components.
- AI API key kept in environment variables, never bundled client-side.
- n8n webhook URL kept in environment variables.
- Validate all incoming request payloads at API route boundaries.
- Validate all data received from Google Sheets before use.

---

## 9. Deferred Decisions

| Decision | Deferred Until |
|---|---|
| Persistent database as a source of truth | Multiple concurrent users or data relationship complexity. An optional PostgreSQL working copy exists (proposed in [ADR-0006](adr/0006-database-working-copy-and-sync-conflicts.md), see [`DATABASE.md`](DATABASE.md)); Sheets remains the source of truth. |
| Redis / caching | Google Sheets API rate limits become a real problem |
| Separate backend service | API Routes become insufficient |
| Multi-tenant support | Phase 7 (Scale) |

### Optional database working copy (`lib/db/`, `scripts/`)

`lib/db/` holds the drizzle schema (`schema.ts`) and the connection (`index.ts`, `ssl.ts`); the database is used only when `DATABASE_URL` is set (`isDbConfigured()`). Migrations are in `drizzle/`. `scripts/` contains the user-run tooling: `migrate.ts`, `seed-db.ts`, `db-inspect.ts`, `print-baseline-sql.ts` and the file-to-database sync scripts (`sync-diary-to-remote-db.ts`, `sync-schedule-to-remote-db.ts`), which default to a dry run and read private rows from gitignored `data/private/`. Agents never connect to the remote database. Rules and procedures: [`docs/DATABASE.md`](DATABASE.md); status of the decision: [ADR-0006](adr/0006-database-working-copy-and-sync-conflicts.md) (Proposed).

### Agent API and approval (`app/api/agent/`, `app/api/agent-admin/`, `lib/agent/`)

An external agent (OpenClaw) can read onboarding data and propose changes; it can never apply them. See [ADR-0007](adr/0007-agent-api-and-approval-boundary.md) (Proposed).

- `app/api/agent/v1/*`: bearer-token routes (`nova_agt_...`). Every handler is wrapped by `withAgentRoute` (`lib/agent/auth.ts`); `middleware.ts` only checks the header shape because the edge runtime cannot reach the database. Database mode only.
- `app/api/agent-admin/*`: owner-only routes (tokens, proposals, approve, reject, audit). Cookie session plus `AGENT_ADMIN_EMAILS` via `requireAdminSession` (`lib/agent/admin-auth.ts`); a bearer header is rejected.
- `lib/agent/`: `tokens.ts` / `scopes.ts` / `auth.ts` (credentials), `audit.ts` / `rate-limit.ts`, `read/` (database projections), `domains/` (per-domain validation, snapshot and executor), `proposals.ts` (creation), `approvals.ts` (approve and reject), `tokens-admin.ts` (issue and revoke), `config.ts` (limits from `AGENT_*` variables).
- UI: Settings section `app/components/AgentAccessSection.tsx` with `app/components/AgentProposalCard.tsx`; the pending-count badge is `AgentPendingBadgeView` in `app/components/PrimaryNav.tsx`, rendered next to the Settings item by `app/components/AppShell.tsx`; the browser helper is `lib/agent-admin-client.ts`.
- Tables (migration `drizzle/0001_agent_access.sql`): `agent_tokens`, `agent_proposals`, `agent_audit_log`.
- Boundary rule: nothing under `lib/agent/` or `app/api/agent*/` may write to Google Sheets or import `readSchedule`.

Data flow:

```
OpenClaw skill --GET (bearer)--> /api/agent/v1/* --> lib/agent/read --> PostgreSQL
OpenClaw skill --POST /proposals (bearer)--> validate --> agent_proposals (status pending)
Owner (browser, Settings) --> /api/agent-admin/proposals --> reviews before/changes diff
Owner --POST approve--> one transaction: expiry, token, warnings, staleness (SQL) --> apply to the DB table
                                      --> proposal executed + audit row
OpenClaw --GET /proposals/:id--> status (executed | rejected | failed | expired | cancelled)
```

Execution writes PostgreSQL only. The spreadsheet is updated later, if at all, by the user's existing bulk sync (ADR-0006).

See [`docs/ROADMAP.md`](ROADMAP.md) for phase definitions.
