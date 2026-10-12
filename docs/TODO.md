# TODO

**Product:** NOVA (Newcomer Onboarding & Virtual Assistant)
**Last updated:** 2026-10-03

> This file tracks **what to work on right now**.
> For product direction, see [`docs/ROADMAP.md`](ROADMAP.md).

---

## Current Sprint — Phase 0: Foundation

### P0 (blocking)

- [x] Initialize Next.js project with App Router
- [x] Configure TypeScript (strict mode)
- [x] Configure Tailwind CSS
- [x] Configure ESLint
- [x] Create application shell (layout, root page)
- [x] Set up Google OAuth (OAuth 2.0 flow with encrypted HTTP-only session cookie and callback at http://localhost:4000/api/auth/callback/google)
- [x] Enforce required login: Next.js Edge middleware redirects unauthenticated users from dashboard and all protected pages to `/login`, and returns 401 for protected API routes
- [x] Dedicated `/login` page with Google OAuth button, error handling, feedback notices, and dynamic destination redirect preservation
- [x] Create `lib/sheets/` Google Sheets API client boundary
- [x] Read Schedule sheet — validated fallback rows until credentials are configured
- [x] Define `Activity` TypeScript type
- [x] Build Today page with functional local session flow

### P1

- [x] Build `ActivityCard` component
- [x] Add Start Session button (local state only)
- [x] Add Finish Session button (local state + API boundary)
- [x] Calculate actual duration from start/end timestamps
- [x] Add Sheets write boundary with explicit pending state when unconfigured

### P2

- [x] Add learning capture text input
- [x] Add manual diary entry flow
- [x] Integrate AI summarization endpoint (assistive, unconfirmed output)
- [x] Add optional browser voice input with text fallback
- [x] Add local append-only session and diary history
- [x] Add integration readiness endpoint without exposing credentials
- [x] Add shared primary navigation for Today, History, and Settings

### UI v2 redesign (credential-free MVP surface)

- [x] Redesign Today page — progress header, current-activity focus card, "Something changed?" disclosure, dot-based timeline, status bar
- [x] Add Journey page — 90-day timeline with phases and milestones
- [x] Rename History to Learnings (navigation label, page title, copy)
- [x] Replace quick-note stub with expanding capture; drafts listed under Learnings
- [x] Fix completion-moment activity name, header progress merge with local sessions, and reload hydration (found in browser QA)
- [x] Consolidate design system into `docs/DESIGN.md` (v2)

### Schedule import (local-first alternative to Sheets)

- [x] `lib/import/` — CSV (RFC4180, auto-delimiter) and XLSX (fflate + fast-xml-parser, shared strings, inline strings) parsers with validated row→Activity mapping
- [x] Multi-sheet HR workbook support (`parseXlsxSheets`) with smart sheet selection (`Schedule`), diary sheet extraction (`Onboarding Diary`), HR column aliases (`Topic`, `Progress`, `Main Media`, `Duration (minutes)`, `Date`), and flexible/TBD session timings
- [x] `POST /api/import` — multipart boundary: 2 MB cap, size/type validation, `ImportError` → user-presentable 400s
- [x] Settings → Schedule section: file picker, parse preview (count, skipped rows, warnings, first activities, diary notes count), explicit confirm/discard, remove
- [x] Today + Learnings prefer the imported schedule (`onboarding-imported-schedule` localStorage, validated read) with a dedicated status badge
- [x] Discoverability: "Import your own schedule" link on Today next to the status badge whenever the app runs on demo/offline data (hidden once a real schedule is loaded)
- [x] Tests: 40 tests across csv/xlsx/import-schedule/imported-schedule and actual HR workbook integration suites

### UI v3 polish (fresh theme + motion)

- [x] Enable the Tailwind CSS PostCSS pipeline (`@tailwindcss/postcss` + `postcss.config.mjs`) — utilities had never compiled; the app ran on a minimal fallback stylesheet
- [x] Remove the unlayered fallback CSS (it would have overridden every Tailwind utility under cascade layers)
- [x] Add gradient theme: indigo page-top tint, `.hero-gradient` cards, `.bar-gradient` progress fills, `.text-gradient` page titles
- [x] Add motion: staggered `fade-up` entrances, `pop-in` moments, `pulse-soft` live indicator, progress `shimmer`, animated nav underline, button hover lift — all disabled under `prefers-reduced-motion`
- [x] Give every bare `border` utility an explicit color (Tailwind default is `currentColor`)
- [x] Re-verify layout at desktop + mobile (no overflow/overlap regressions) and capture `screenshots/theme-*.png`

### UI v3 redesign (warm human-first design language)

- [x] Design token foundation in globals.css: cream `#fafaf7` base with sun radial tint, emotion palettes as Tailwind v4 utilities (mint/peach/lavender/sun), stone ink replacing slate, 28px `rounded-card`, warm `shadow-soft`/`shadow-lift`, spring/celebrate/float keyframes
- [x] Today: 👋 greeting + reactive human line, big-stat typography (giant `N of N`), growth stages 🌱→🌿→🌳, warm focus card, day-journey rail with connector, spring completion moment, `Day wrapped up 🎉` celebration
- [x] Journey + PrimaryNav: huge percentage display, floating growth emoji, milestone path rail, filled-pill active nav
- [x] Learnings + Settings + ExportNotes: visual summaries, personality copy, human empty states ("Your day is still unwritten."), warm export toolbar
- [x] GuideTour + Assistant: mint spotlight, refreshed personality copy, lavender assistant bubbles, floating ✨ launcher
- [x] Zero slate-* classes remain; verified typecheck/lint/82 tests/build + browser QA (desktop + mobile, geometry clean); screenshots in `screenshots/warm-*.png`

### Notes export (batch, client-side)

- [x] `lib/export-notes.ts` — pure serializers: RFC4180 CSV (UTF-8 BOM, CRLF, quote escaping) and Markdown (UTC `##` headings), plus `onboarding-notes-YYYY-MM-DD.ext` filename builder
- [x] Selection checkboxes on every diary entry and quick note on Learnings, with stable ids
- [x] Export toolbar (visible only when notes exist): select-all with indeterminate state, "N of M notes selected", CSV/Markdown format picker, count-labeled export button, Clear
- [x] Client-side Blob download (no server round-trip); selection persists after export; status message confirms
- [x] Browser QA: byte-level BOM check, quote/newline escaping, partial selection, both formats, cleanup verified

### AI assistant (Groq provider)

- [x] `lib/ai/assistant.ts` — validated chat messages (1–20, roles, length caps), system prompt enforcing assistive-only behavior, env-driven provider config (`GROQ_API_KEY`, `GROQ_MODEL`, optional `GROQ_BASE_URL` — no model ID hardcoded)
- [x] `POST /api/ai/assistant` — 400/503/502 boundary handling; `/api/health` `ai` flag now lights for Groq config too
- [x] `Assistant` component — floating ✨ launcher on every page, chat panel with loading state, failure notice with draft restore, unconfigured hint, Esc to close
- [x] QA against a mock Groq endpoint via `GROQ_BASE_URL` override (auth, model passthrough, history, failure path)

### Guide tour (first-run experience)

- [x] Add `lib/guide-tour.ts` — validated tour state persistence (`onboarding-guide-tour` localStorage key)
- [x] Add `GuideTour` component — spotlight, popover, keyboard navigation (←/→/Esc/Tab), reduced-motion support
- [x] Auto-start tour on first visit to Today; restart via Settings → "Restart the guide tour" (`/?tour=start`)
- [x] Tag tour targets with `data-tour` attributes (status bar, progress header, activity card, timeline, quick note, primary nav)

### Continuous integration

- [x] GitHub Actions workflow (`.github/workflows/ci.yml`) — push/PR to `main`, pinned action versions, pnpm cache, least-privilege `contents: read`, 15-minute timeout, per-branch concurrency with cancel
- [x] CI gates mirror the local definition of done: `pnpm typecheck` + `pnpm lint` + `pnpm test` + `pnpm build` — no secrets required (all env reads happen at request time, so the build runs without `.env.local`)
- [x] `packageManager` field in `package.json` pins pnpm 11.15.0 so CI and local runs agree

### Elevating the Learning Feature (structured local learning records, [ADR-0005](adr/0005-learning-records-and-ai-provider-chain.md))

- [x] `lib/local-records.ts`: additive learning record schema with optional `id`, `activityId`, `activityName`, `source`, `updatedAt` on diary entries; legacy `{ content, createdAt }` records remain accepted; deterministic stable IDs derived at read time, persisted on new writes
- [x] `LearningModal`: reusable accessible capture dialog (focus trap, Esc to dismiss) for manual and AI-assisted notes; AI summary rendered as an editable draft with an explicit review-and-confirm checkbox (ADR-0003); editing the summary resets confirmation
- [x] AI summarize provider chain: server-side and deterministic (`lib/ai/providers.ts`); fully configured Groq first, generic OpenAI-compatible endpoint second, deterministic local heuristic fallback (`heuristicSummary` in `lib/ai/client.ts`)
- [x] Diary sync projection: `diarySyncPayload` sends exactly `{ content }` to `POST /api/diary`; structured metadata is local-only
- [x] Learnings filters: search, source (manual / quick-note / AI-assisted / legacy), and activity filters over diary entries and quick notes (`lib/learning-records-view.ts`)
- [x] Explicit record management: inline diary edit (stamps `updatedAt`, keeps `createdAt`), two-step delete confirmation, quick-note → diary conversion preserving the original timestamp
- [x] Deterministic structured export: CSV (RFC4180, UTF-8 BOM, metadata columns) and Markdown (UTC headings and metadata); record IDs are never exported; selection and export operate on the filtered list
- [x] Run the full quality gates for this slice (`pnpm typecheck` / `lint` / `test` / `build`) — 23 suites / 246 tests passing
- [x] Browser QA for the capture modal, Learnings filters, edit/delete/convert, filtered selection/export, and Settings import flows; responsive captures verified at 375px, 768px, and 1280px with no horizontal overflow

### Spreadsheet Cockpit & Elevated Diary Experience (Schedule, Onboarding Diary, Feedback Sheet, Timeline)

- [x] **Milestone 1: Elevated Onboarding Diary Experience** — Guided 3-takeaway diary creation workflow aligned with the HR workbook (`Onboarding Diary` worksheet): pre-population of Topic, PIC, Day, Date, Week, Activity Count from active activities; assistive AI structuring and speech-to-text voice input; 1-click 9-column TSV clipboard copy (`clipboardRowForDiary`) formatted for cell A of Excel/Sheets.
- [x] **Milestone 2: Feedback Sheet System** — Interactive evaluation dashboard covering all 13 official onboarding sessions from the HR workbook (`Feedback Sheet` worksheet): progress indicator ("X of 13 evaluated"), 6-dimension Likert rating form (1–5 scale), qualitative follow-up questions, and 1-click 13-column TSV clipboard copy (`clipboardRowForFeedback`).
- [x] **Milestone 3: Interactive Timeline & Evidence Tracker** — Upgraded `/journey` reflecting the 3 HR stages (Stage 1.0: Training – Month 1, Stage 2.0: Trial – Month 2, Stage 3.0: Transition – Month 3): editable start and end dates with date-picker inputs, interactive checklist for all 12 HR evidence/deliverable items, visual stage progress metrics, and 1-click 9-column TSV clipboard copy (`clipboardRowForTimelineStage`).
- [x] **Milestone 4: Schedule Completion & Clipboard Copy** — Manual time tracking and schedule row export for the `Schedule` worksheet: 1-click completion with custom actual times, duration calculation, and 1-click 4-column (`clipboardRowForSchedule`, columns H–K) and 11-column (`clipboardRowForScheduleFull`, columns A–K) TSV clipboard copy on Today and Learnings.
- [x] **Zero-defect Verification** — strict TypeScript (`pnpm typecheck`), zero ESLint errors (`pnpm lint`), 28 test suites / 481 tests passing (`pnpm test`), and Next.js production build (`pnpm build`).

### UI/UX Cockpit Simplification & Progressive Disclosure (Now & Next Focus)

- [x] **Separation of Concerns**: Split the cluttered multi-week schedule off of Today (`/`), creating a dedicated Master Schedule page (`/schedule`) for multi-week browsing, search, and day/status filtering.
- [x] **High-Focus Today Cockpit**: Redesigned `/` around the primary question "What should I do now?", featuring hero timer, daily pulse progress, and clean 1-row task cards with active focus indicators.
- [x] **Smart Fallback Agenda**: Displays upcoming journey activities when 0 activities are explicitly scheduled on the calendar date (weekends / off-calendar days).
- [x] **Progressive Disclosure Slide-over Sheet**: Created `ActivityDetailSheet` (right-side drawer on desktop, bottom sheet on mobile) to reveal subtopic outlines, timing, PIC, media, notes, TSV copy, and direct Google Sheets sync on demand.
- [x] **App-Wide Progressive Disclosure Rollout**: Extended the cockpit + slide-over drawer pattern across Feedback (`/feedback`), Diary (`/diary`), Timeline (`/timeline`), Monthly Reviews (`/reviews`), and Glossary (`/glossary`) with `FeedbackDetailSheet`, `DiaryDetailSheet`, `StageDetailSheet`, `ReviewDetailSheet`, and `GlossaryDetailSheet`, achieving 100% design system consistency with sequential Prev/Next navigation and inline edit toggle without nested modals.
- [x] **Persistent Sidebar Navigation Shell**: Migrated horizontal header navigation into an ergonomic `AppShell` with desktop left sidebar, categorized sections (Daily Execution, Milestones & Growth, Reflections & Input, System & Knowledge), quick `⌘K` search trigger, and mobile slide-out drawer.
- [x] **App-Wide Non-Technical Guide Tour (Feature Priority Walkthrough)**: Redesigned the onboarding guide tour to actively navigate across all pages (`/`, `/schedule`, `/timeline`, `/reviews`, `/diary`, `/feedback`, `/glossary`, `/settings`) and teach the primary action on each page (e.g. tracking work with stopwatch on Today, documenting 3 key learnings and reflections on Diary, checking off stage deliverables on Timeline, conducting 1-on-1 reviews, rating sessions on Feedback, searching modules on Glossary, and cloud sync/backup on Settings). Formatted with 3 actionable numbered steps and pro-tips per feature, with spotlight targets attached directly to the core feature elements on each page.
- [x] **Navigation & Quality Gates**: Verified 0 errors across `pnpm typecheck`, `pnpm lint`, `pnpm test` (42 suites / 581 tests), and `pnpm build`.

### UI/UX pass (2026-10-03)

Ten points, plan in `.plans/ui-ux-pass.md` (revision 4). Display and navigation only: no API route, `lib/sheets/*`, clipboard/TSV builder or written data changed, except the flagged schedule bulk-sync payload (now only rows with data). Design details are in [`docs/DESIGN.md`](DESIGN.md). The final browser verification (step 9.3) and the final review (9.4) are still to run.

- [x] **1. Mobile layout and FAB** — done: content wrapper `min-w-0` + `overflow-x-clip` on `main`, 44px targets, safe-area padding, FAB/timer/toast stacked without overlap, FAB hides under modal dialogs (`useModalPresence`).
- [~] **2. Hide the spreadsheet** — partial: Row/Col/PIC wording replaced by `RowTag` and "Sheet tools" menus everywhere in the UI; the rendered jargon listed under open items below remains.
- [x] **3. Truthful sync status** — done: one `SyncStatusChip` derived from `/api/health`, the pending queue and the last confirmed write (`lib/sync-status.ts`); hardcoded "Connected"/PostgreSQL text removed; feedback pull failures show one inline notice with Retry.
- [x] **4. One safe bulk-sync modal** — done: shared `BulkSyncModal`, exact ranges and counts, blocking rows with Fill, non-dismissible while busy, never posts an empty schedule list. Residual write risks are in Technical Debt below.
- [x] **5. Staged learning capture** — done: `LearningModal` write / review / takeaways stages, sticky Save, no auto-confirm of AI output (ADR-0003).
- [x] **6. Schedule restructure** — done: grouped by week with sticky headers, one-line completed rows, Hide completed (persisted), Jump to next, mobile filter disclosure, hash/`nova:focus-activity` deep links.
- [x] **7. Navigation, redirects and titles** — done: 8 nav items, `ReviewsTabs` for Reviews / First month / Monthly score, `/journey` and `/history` redirect permanently, `%s · NOVA` titles, skip link, one global command palette, tour copy updated.
- [x] **8. Today: off-day state, counts, hydration, dates** — done: "Nothing scheduled today" with a next-activity CTA, computed counts (no hardcoded 59), time-derived output after mount, display dates in Asia/Jakarta (`lib/format-date.ts`), no hardcoded name.
- [~] **9. Readability and accessibility** — partial: 12px text minimum (11px uppercase eyebrows only), `stone-500` text, darker mint/peach tokens with `-800/-900/-950`, `focus:outline-hidden` removed, focus restore and Escape order fixed; the global focus outline contrast and the button hover lift remain (open items).
- [~] **10. Dead code** — partial: both old sync modals deleted and `FeedbackModal` helpers moved to `lib/feedback.ts`; the files listed below are not yet deleted.

Open items from this pass:

- [ ] Delete dead files (zero importers). Not done because the permission system refused `rm` in this run: `app/components/ActivityDetailModal.tsx`, `GlossaryDetailModal.tsx`, `PrimaryNav.tsx`, `DiaryModal.tsx`, `ExportNotes.tsx`, `LearningRecordCard.tsx`, `FeedbackModal.tsx`, `app/journey/page.tsx`, `app/history/page.tsx` (the last two are shadowed by the redirects). Re-grep for importers first.
- [ ] Rendered jargon left because those paths were off-limits for this pass: `lib/sheets/extractor.ts` lines 190 and 294 ("Session at Row N" / "Topic at Row N") and `lib/import/import-schedule.ts` line 208.
- [ ] The global `:focus-visible` outline (`#35c98e`, `app/globals.css`) is only about 2:1 on white. Use a darker ring (for example `mint-700`).
- [ ] `app/globals.css` line 125: the `button:not(:disabled):hover` lift also applies to text-link buttons. Scope it.
- [ ] `lib/glossary.ts` line 138: "Department PIC" source text still uses the PIC wording.
- [ ] Residual risk (ADR-0006 follow-up, not fixed here): schedule rows with partial data write `''` to their empty cells, which clears those sheet cells (route + `USER_ENTERED`, `lib/sheets/extractor.ts` around lines 559 and 656). The bulk-sync warning says so.
- [ ] Residual risk (ADR-0006 follow-up 5, not fixed here): formula injection through `valueInputOption=USER_ENTERED` on user-typed text.
- [ ] Follow-up (not fixed here): the chip "Synced HH:MM" can reflect a database write rather than a sheet write (R1 behavior).
- [ ] Follow-up (not fixed here): Settings "Writing the schedule/diary: Not configured" reflects only the Apps Script env flags and ignores OAuth (`lib/connection-status.ts` around lines 62-65).
- [ ] Follow-up (not fixed here): "Sync this row" on a not-started schedule card sends progress 'Done' (`app/schedule/page.tsx` around line 254). Pre-existing write hazard.
- [ ] Follow-up (not fixed here): the schedule sync modal does not say when it is syncing the bundled fallback catalog because `/api/schedule` failed (`app/schedule/page.tsx` around lines 121-124).
- [ ] Follow-up (not fixed here): the feedback pull falls back to `?source=local` but says "Loaded N evaluations from the sheet" (`app/feedback/page.tsx` around lines 62-90).
- [ ] Follow-up (not fixed here): CommandPalette searches only the first 30 activities (`app/components/CommandPalette.tsx` line 185).
- [ ] Follow-up (not fixed here): stacked dialogs. Esc in ScheduleFillModal or LearningModal opened over ActivityDetailSheet closes both.

---

## Bugs

- [ ] Logout redirects to a caller-supplied `redirect` parameter via `new URL(redirectTo, request.url)` (`app/api/auth/logout/route.ts`, lines 6 and 16-18). (ADR-0006 follow-up 6)
- [ ] Login `returnTo` check misses `/\evil.example` (`app/api/auth/login/route.ts`, line 35). (ADR-0006 follow-up 6)
- [ ] Login passes `redirect_uri` through from the query string (`app/api/auth/login/route.ts`, line 13). (ADR-0006 follow-up 6)
- [ ] `x-forwarded-host` is trusted (`lib/auth/config.ts`, line 38). (ADR-0006 follow-up 6)
- [ ] `writeDiary` is a no-op that reports success in database mode (`lib/sheets/client.ts`, lines 132-135). (ADR-0006 follow-up 6)
- [ ] `/api/diary` answers 400 when the database write fails (`app/api/diary/route.ts`, lines 98-106). (ADR-0006 follow-up 6)
- [ ] `/api/sheets/extract` fabricates an identity in database mode. (ADR-0006 follow-up 6)
- [ ] `/api/diary/sync` writes a whole G:H block with no read-before-write; it can overwrite hand edits. (ADR-0006 follow-up 6)
- [ ] The sync plan output counts a `session_logs` prune blocker under the `file:` section instead of `activities:` (`scripts/lib/sync-schedule.ts`, `formatPlan` in `scripts/lib/sync-common.ts`). Cosmetic.

---

## Technical Debt

- [ ] Add sheet-sync marker columns (last value written to the sheet, per row) via a drizzle migration. (ADR-0006 follow-up 1, proposed)
- [ ] Per-row read-compare-write in `/api/diary/sync` and `/api/schedule/sync`: verify label column, compare with marker, surface conflicts, allow intentional clearing. (ADR-0006 follow-up 2)
- [ ] Remove the arbitrary `range`/`values`/`value` passthrough in `/api/sheets/update-cell`; restrict feedback writes to columns D:M. (ADR-0006 follow-up 3)
- [ ] Unify activity matching on `activities.id` across `update-cell`, the sync routes and `writeSession`. (ADR-0006 follow-up 4)
- [ ] Write user-typed learned/notes with `valueInputOption=RAW` instead of `USER_ENTERED` (`lib/sheets/extractor.ts`, lines 559, 562, 656): formula-injection risk. (ADR-0006 follow-up 5)
- [ ] Large files to split (line counts checked with `wc -l` on 2026-10-03, after the UI/UX pass): `lib/schedule-catalog.ts` 1143, `app/page.tsx` 1017, `lib/timeline.ts` 911, `app/components/Icons.tsx` 876, `app/components/LearningModal.tsx` 822, `app/schedule/page.tsx` 805, `app/components/FeedbackDetailSheet.tsx` 786, `lib/sheets/extractor.ts` 731, `app/first-month-review/page.tsx` 628.
- [x] `DiarySyncAllModal.tsx` and `ScheduleSyncAllModal.tsx` were near-duplicates: both are deleted and replaced by one shared `BulkSyncModal` (`app/components/BulkSyncModal.tsx`, plans in `lib/bulk-sync.ts`). `ScheduleFillModal.tsx` remains separate (single-row edit).
- [ ] ADR-0006 is Proposed. Accept or reject it; the follow-ups above and in the Bugs section are its consequences. Nothing may claim it is accepted until then.
- [ ] Public history: commit `7352f74` (and later commits) in this public repository exposes schedule data, spreadsheet share links and a personal filesystem path. Decide whether to rotate the share links and/or rewrite history. Private rows now live in gitignored `data/private/`.
- [ ] `eslint.config.mjs` defines no rules (only `ignores`), so `pnpm lint` checks almost nothing. Add a real rule set.
- [ ] `pnpm db:seed` (and other `tsx` scripts) fail from a non-root cwd because `lib/feedback.ts`, `lib/timeline.ts` and `lib/schedule-catalog.ts` use `@/` imports. Make them relative.
- [ ] `lib/test-globals.d.ts` narrows the jest globals (hides `describe.skip`, `toHaveBeenCalled*`, `expect.any`). Consider real `@types/jest`.
- [ ] `lib/db/migrations.integration.test.ts` hardcodes the migration count (now 2, line 63). Update it whenever a migration is added.
- [ ] `pnpm build` was not verified without `.env.local` in the database-hardening change set. Verify it.
- [ ] User action: run `pnpm db:inspect` against the remote database yourself, then follow the baseline procedure in [`docs/DATABASE.md`](DATABASE.md#existing-remote-database-created-by-the-old-seed-script-user-run-only). Agents never connect to it.
- [ ] Sync script dry-run output prints private values (learned text, notes, links). Do not paste it into public places; see [`docs/DATABASE.md`](DATABASE.md#output-contains-your-data).

### Agent API follow-ups ([ADR-0007](adr/0007-agent-api-and-approval-boundary.md), Proposed)

- [ ] `session_logs` delete via the agent API (deferred; no delete exists for sessions).
- [ ] MCP adapter (`mcp.servers.nova`, `streamable-http`) over the same `lib/agent/*` functions; the skill uses curl for now.
- [ ] `/hooks/wake` notifier so OpenClaw learns when a proposal is decided (polling `GET /proposals/:id` for now).
- [ ] Audit log retention (`agent_audit_log` grows without bound).
- [ ] Client-side overlay / stale-tab fix: an open browser tab can overwrite an agent-executed change on its next save (out of scope for the agent API).
- [ ] Formula-like text and `USER_ENTERED` in the sync routes (ADR-0006 follow-up 5): agent-proposed text that starts with `=`, `+`, `-` or `@` can reach the sheet as a formula.
- [ ] "Unsynced after agent execution" marker: agent edits are not flagged for the bulk sync. This is a sync change and needs its own plan, momus review and the spreadsheet-sync-safety matrix.
- [ ] User action: run `pnpm db:migrate "$URL"` on the remote database BEFORE deploying the agent API code (see ADR-0007, Deploy and rollback).

---

## Blocked

Nothing is currently blocked. Google OAuth and the Sheets workbook mapping are in place.

---

## Completed

- [x] Documentation scaffold created (README, AGENTS, PRD, ARCHITECTURE, DESIGN, ROADMAP, ADRs)
