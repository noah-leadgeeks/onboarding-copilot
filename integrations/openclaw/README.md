# OpenClaw integration

Wires an OpenClaw agent to the NOVA agent API ([ADR-0007](../../docs/adr/0007-agent-api-and-approval-boundary.md), Proposed). The agent reads data and proposes changes; the owner approves them in the app. This repository is public: use placeholders only, never real tokens, hosts or emails.

Verification: the SKILL.md frontmatter keys (`name`, `description`, `metadata.openclaw.requires.{bins,env}`, `primaryEnv`) and the config keys `skills.entries.<name>.{enabled,apiKey,env}` were checked against https://docs.openclaw.ai/tools/skills on 2026-10-12. Re-check them if your OpenClaw version is newer.

## Install

1. Apply migration `0001_agent_access` to the database (`pnpm db:migrate "$URL"`) and deploy the app. Set `AGENT_ADMIN_EMAILS` and `AUTH_SECRET` (see the README).
2. In the app, open Settings, AI agent access, and issue a token with the scopes you want (for example `schedule:read`, `diary:read`, `diary:propose`). The plaintext token is shown once.
3. Copy `integrations/openclaw/nova/` into your OpenClaw skills directory.
4. In `~/.openclaw/openclaw.json`:

```json5
{
  skills: {
    entries: {
      nova: {
        enabled: true,
        apiKey: "<nova_agt_token>",            // exposed as NOVA_AGENT_TOKEN (primaryEnv)
        env: { NOVA_BASE_URL: "https://<your-app-host>" }
      }
    }
  }
}
```

## Notes

- Authenticated calls go through `exec` and `curl`; `web_fetch` is GET-only and cannot send headers.
- **Exec approvals.** Allowlist the pattern `curl` plus an anchored regex `argPattern` that is matched on the arguments only (not on the command name), restricted to your `NOVA_BASE_URL`, so every call does not prompt. The rules are stored in `~/.openclaw/state/openclaw.sqlite`, table `exec_approvals_config`, for agent id `main`. OpenClaw states that approvals are not a per-user auth boundary; the server-side approval in the app is the real control.
- **Injected env does not override** a variable that is already set in the process environment. If `NOVA_AGENT_TOKEN` or `NOVA_BASE_URL` is already exported, that value wins, so unset it after rotating a token.
- **Injection is not applied inside a sandbox.** Sandboxed runs will not see the skill's env values.
- Transcripts keep raw text. Never print the token or run `curl -v`.
- Rotation: issue a new token, update `apiKey`, then revoke the old one in Settings (`lastUsedAt` shows which is live). Revoking also cancels that token's pending proposals.
- The agent's `/today` is the database view only and cannot see browser-local data. Executed changes reach the spreadsheet only through the app's bulk sync.
- Not included yet: an MCP adapter and an inbound `/hooks/wake` notifier (see `docs/TODO.md`).
