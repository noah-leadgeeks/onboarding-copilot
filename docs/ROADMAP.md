# Roadmap

**Product:** NOVA (Newcomer Onboarding & Virtual Assistant)
**Last updated:** 2026-10-03

> The roadmap defines **where the product is going**.
> For what to work on right now, see [`docs/TODO.md`](TODO.md).

---

## Where We Are Now

**Updated:** 2026-10-03

| | |
|---|---|
| **Done** | Phases 0–3 are functionally complete, and Google OAuth login, Sheets read/write sync, the Phase 4 Feedback flow and the optional PostgreSQL database mode have shipped (confirmed by the product owner). Today dashboard, Journey view, session timing, learning capture (text + voice + assistive AI), diary and quick notes, pending-sync queue with retry, a first-run guide tour, and schedule import from Excel/CSV files (Settings → Schedule) all work. |
| **Next** | Finish Phase 4 (feedback history view), then harden the database/Sheets sync (see [`docs/TODO.md`](TODO.md) and [ADR-0006](adr/0006-database-working-copy-and-sync-conflicts.md), proposed). |
| **Blocked** | Nothing is tracked as blocked. Known sync and auth defects are listed under Bugs in [`docs/TODO.md`](TODO.md#bugs). |

> The application is a cockpit over the spreadsheet, not a replacement. Local-first behavior is intentional: every feature works without credentials, and sync is used when the connection exists. Database mode ([`docs/DATABASE.md`](DATABASE.md)) is optional and is not a source of truth.

---

## Phase 0 — Foundation

**Goal:** Create the basic application skeleton and establish the Google Sheets connection.

**Status:** Complete. Deployment to a development environment is not yet recorded.

- [x] Project bootstrap (Next.js + TypeScript + Tailwind)
- [x] TypeScript strict mode configured
- [x] ESLint configured
- [x] Google OAuth authentication
- [x] Google Sheets API client (`lib/sheets/`)
- [x] Read Schedule sheet *(validated fallback rows when Sheets is not configured)*
- [x] Define `Activity` type
- [x] Environment variable setup and documentation
- [ ] Deployment to development environment

---

## Phase 1 — Today Dashboard

**Goal:** Remove the need to navigate the spreadsheet during the working day.

**Status:** Complete.

- [x] Today's activities view
- [x] Current activity card
- [x] Next activity card
- [x] Activity status display (not started / in progress / done)
- [x] Daily progress indicator
- [x] Remaining activities count
- [x] Empty state (no activities today)
- [x] Error state (Sheets unavailable)
- [x] Journey view (90-day timeline with phases and milestones)
- [x] First-run guide tour (walkthrough of the cockpit, restartable from Settings)
- [x] Schedule import from spreadsheet files (.xlsx/.csv/.tsv) with preview and confirmation — local alternative to the Sheets connection

---

## Phase 2 — Automatic Time Tracking

**Goal:** Remove manual start/end time entry from the employee's responsibilities.

**Status:** Complete.

- [x] Start session action
- [x] Live session timer
- [x] Finish session action
- [x] Actual duration calculation
- [x] Sync actual times to Schedule sheet
- [x] Handle late starts (scheduled time has already passed) — detected by the session API; "Started late" deviation note in the UI
- [x] Handle cancelled activities — "Cancelled" deviation note in the UI
- [x] Sync failure handling (pending state, retry)
- [x] Sync status indicator in UI

---

## Phase 3 — Learning Capture

**Goal:** Make the Onboarding Diary effortless to complete.

**Status:** Complete.

- [x] Manual text input for learning notes
- [x] Voice input for learning notes
- [x] AI extraction and structuring of raw notes
- [x] User review and edit of AI output
- [x] User confirmation before saving
- [x] Sync learning entry to Onboarding Diary sheet *(queued locally while the write connection is unavailable)*
- [x] Skip / defer learning capture option
- [x] Quick note drafts (captured on Today, listed under Learnings)

---

## Phase 4 — Feedback

**Goal:** Simplify completion of the Feedback Sheet.

**Status:** Mostly shipped. Only the feedback history view is open.

> Design constraint: AI may draft or suggest feedback wording, but submission always requires explicit user confirmation (see [ADR-0003](adr/0003-ai-is-assistive-not-authoritative.md)).

- [x] Mobile-friendly feedback interface
- [x] Rating capture (numeric or scale)
- [x] Structured question responses
- [x] Free-text comments
- [x] User confirmation before submitting
- [x] Sync to Feedback Sheet
- [ ] Feedback history view *(only a pending/evaluated filter over the 14 sessions exists today)*

---

## Phase 5 — Automation

**Goal:** Let the system proactively assist the employee without requiring manual check-ins.

**Status:** Not started.

> n8n remains optional plumbing (see [ADR-0002](adr/0002-n8n-for-automation.md)); core features must not depend on it.

- [ ] n8n integration and webhook setup
- [ ] Morning briefing (today's schedule summary)
- [ ] Session reminder notifications
- [ ] Missing-record detection (sessions without learning notes)
- [ ] Daily summary generation
- [ ] Weekly progress summary

---

## Phase 6 — Intelligence

**Goal:** Reduce manual logging further through smarter capture.

**Status:** Not started.

- [ ] Google Calendar integration (activity detection)
- [ ] Voice-first daily logging
- [ ] Natural-language daily log ("I spent the morning on IT systems orientation")
- [ ] Automatic schedule reconciliation from calendar

---

## Phase 7 — Scale

**Status:** Not started.

**Deploy only if required by organizational growth.**

> Any persistent database introduced here requires a new ADR (see [ADR-0001](adr/0001-google-sheets-as-source-of-truth.md) for the current storage decision).

- [ ] Persistent database (with ADR) — ADR-0006 proposed; awaiting acceptance
- [ ] Multi-employee support
- [ ] Manager dashboard
- [ ] HR reporting
- [ ] Role-based access control
- [x] Audit log (agent API requests and owner decisions: `agent_audit_log`, [ADR-0007](adr/0007-agent-api-and-approval-boundary.md))

---

## Principle

Each phase must be independently useful. Do not begin a new phase until the previous phase is stable and tested.

A phase is **stable** when: `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass, and the affected user flow has been verified end-to-end in the browser.
