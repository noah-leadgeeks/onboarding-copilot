# NOVA — Newcomer Onboarding & Virtual Assistant

> **NOVA is a bright guide for every new employee's journey.**
>
> *Don't rebuild the onboarding spreadsheet. Build a cockpit for it.*

A lightweight assistant that makes employee onboarding administration almost effortless and makes onboarding feel less boring and overwhelming.

## Goal

The application provides a simple interface over the existing Google Sheets onboarding workflow. The employee focuses on learning. The system handles the administration.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js + TypeScript + Tailwind CSS |
| Backend | Next.js API Routes |
| Integration | Google Sheets API + Google OAuth |
| Automation | n8n |
| AI | Provider-agnostic LLM API |

## Requirements

- Node.js 18+
- pnpm
For local fallback mode, only Node.js, pnpm, and the project dependencies are
required. Google Cloud, OAuth, Sheets proxies, n8n, and an AI provider are
optional integrations.

## Installation

```bash
git clone <repository>
cd onboarding-copilot
pnpm install
```

## Environment

Create `.env.local` in the project root:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# Optional: defaults to dynamic host/Vercel URL or http://localhost:4000/api/auth/callback/google
GOOGLE_REDIRECT_URI=
GOOGLE_SHEETS_ID=
AUTH_SECRET=
N8N_WEBHOOK_URL=
AI_API_KEY=
AI_API_BASE_URL=
SHEETS_SCHEDULE_URL=
SHEETS_WRITE_URL=
SHEETS_DIARY_URL=
SHEETS_WRITE_TOKEN=

# Groq AI assistant — pick any current Groq chat model; the model is
# configured here, never hardcoded in the app
GROQ_API_KEY=
GROQ_MODEL=
# Optional endpoint override (defaults to the Groq OpenAI-compatible URL)
# GROQ_BASE_URL=https://api.groq.com/openai/v1/chat/completions
```

Use `.env.example` as the starting template. All Google, automation, and AI values are server-only; never expose them through client-side code or commit `.env.local`.

> Never commit `.env.local` or any file containing credentials.

### AI provider precedence

AI features resolve their provider server-side in a fixed order
([ADR-0005](docs/adr/0005-learning-records-and-ai-provider-chain.md)): a fully
configured Groq provider (`GROQ_API_KEY` + `GROQ_MODEL`, optional
`GROQ_BASE_URL`) wins over a fully configured generic endpoint
(`AI_API_BASE_URL` + `AI_API_KEY`). Partially configured providers are ignored.
When neither is fully configured, the app falls back to a deterministic local
heuristic and every feature stays usable without AI.

### Integration contract

`SHEETS_SCHEDULE_URL` is a server-side read proxy that returns a JSON array of
validated activity objects (`id`, `name`, `type`, `plannedStart`, `plannedEnd`,
and a status of `not-started`, `in-progress`, `done`, or `overdue`).

`SHEETS_WRITE_URL` is a server-side write proxy. The app sends `POST` JSON with
`activityId`, `actualStart`, `actualEnd`, and `durationMinutes`; a configured
`SHEETS_WRITE_TOKEN` is sent only as a Bearer header from the server.

When these values are absent or unavailable, sessions and learning notes remain
available locally and are marked pending for later synchronization.

## Database mode (optional)

Setting `DATABASE_URL` switches the app from the Google Sheet to a PostgreSQL
working copy. Sheets stays the source of truth; see
[ADR-0001](docs/adr/0001-google-sheets-as-source-of-truth.md) and the proposed
[ADR-0006](docs/adr/0006-database-working-copy-and-sync-conflicts.md). Setup,
migrations, seeding, sync scripts and the baseline procedure for an existing
database are documented in [`docs/DATABASE.md`](docs/DATABASE.md). Leave
`DATABASE_URL` unset to stay in Sheets mode.

## Agent API (optional, database mode)

An external agent such as OpenClaw can read onboarding data and propose changes
through `/api/agent/v1/*` with a scoped bearer token. Proposals only take effect
after the owner approves them in Settings, in the AI agent access section.
Execution writes the database only, never the spreadsheet. Design and
trade-offs: [ADR-0007](docs/adr/0007-agent-api-and-approval-boundary.md)
(Proposed). OpenClaw setup: [`integrations/openclaw/README.md`](integrations/openclaw/README.md).

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_ADMIN_EMAILS` | none | Required for the admin routes (token issue and revoke, approve, reject, audit). Comma-separated owner emails; when unset or empty every admin route answers 403. |
| `AGENT_RATE_LIMIT_READS_PER_MIN` | 60 | Agent reads per token per minute. |
| `AGENT_RATE_LIMIT_PROPOSALS_PER_MIN` | 10 | Proposal creations and cancellations per token per minute. |
| `AGENT_MAX_PENDING_PROPOSALS` | 20 | Unexpired pending proposals per token. |
| `AGENT_PROPOSAL_TTL_HOURS` | 24 | Proposal expiry. |
| `AGENT_TOKEN_DEFAULT_TTL_DAYS` | 90 | Default token lifetime. |

Production requirements:

- Set `AUTH_SECRET`. Without it (and without `GOOGLE_CLIENT_SECRET`) the admin routes answer 503, because the fallback session key is a public constant.
- Never set `AUTH_DISABLED` in production. It opens every cookie-gated route; the admin routes refuse to run with it on Vercel or when `NODE_ENV=production`.
- Keep the Google OAuth consent screen restricted. The app has no login allowlist in code (ADR-0007).

Deploy order: the release adds migration `drizzle/0001_agent_access.sql`. Run
`pnpm db:migrate "$URL"` against the remote database yourself **before**
deploying (there is no migrate hook in `vercel.json`). A remote database created
by the old seed script must go through the baseline procedure in
[`docs/DATABASE.md`](docs/DATABASE.md) first. Rolling back drops the agent
tables and permanently loses all agent tokens, proposals and the audit log; see
the header of the migration file.

## Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quality Checks

```bash
pnpm typecheck   # TypeScript type checking
pnpm lint        # ESLint
pnpm test        # Unit tests
```

All three must pass before committing.

Continuous integration runs these checks plus `pnpm build` on every push and
pull request to `main` ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Documentation

| Document | Question it answers |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Why are we building this? |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | What does the system look like? |
| [`docs/DESIGN.md`](docs/DESIGN.md) | How should it behave and look? |
| [`docs/DATABASE.md`](docs/DATABASE.md) | How do I run, migrate and sync the optional database? |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Where are we going? |
| [`docs/TODO.md`](docs/TODO.md) | What should we do next? |
| [`docs/adr/`](docs/adr/) | Why did we make this decision? |

## Agent Development

See [`AGENTS.md`](AGENTS.md) before writing any code.

## Project Status

See [`docs/ROADMAP.md`](docs/ROADMAP.md) and [`docs/TODO.md`](docs/TODO.md).
