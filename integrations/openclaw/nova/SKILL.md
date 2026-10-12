---
name: nova
description: Read Noah's onboarding cockpit (today's tasks, schedule, diary, feedback) and propose changes that Noah approves in the app.
metadata:
  { "openclaw": { "requires": { "bins": ["curl"], "env": ["NOVA_BASE_URL", "NOVA_AGENT_TOKEN"] }, "primaryEnv": "NOVA_AGENT_TOKEN" } }
---
# NOVA onboarding cockpit

All calls: curl -sS -H "Authorization: Bearer $NOVA_AGENT_TOKEN" "$NOVA_BASE_URL/api/agent/v1/<path>"

Never use curl -v, --trace or echo the token: the transcript is stored.

## Reading

- Today: GET /today. Schedule: GET /schedule?date=YYYY-MM-DD. Diary: GET /diary. Feedback: GET /feedback.
- Also: /reviews, /timeline, /glossary, /sessions, /me (your scopes and limits).
- /today is the database view only. It does not include Noah's local customizations, imported schedules, quick notes or unsynced sessions, which live in his browser. If he says the data looks different, trust him.

## Changing things

- You cannot change data directly. To change something, POST a proposal. Noah must approve it in the app (Settings, AI agent access). Tell him it is waiting; never say it is saved yet.

  curl -sS -X POST -H "Authorization: Bearer $NOVA_AGENT_TOKEN" -H "Content-Type: application/json" \
    -d '{"domain":"diary","operation":"update","target":{"rowNumber":14},"changes":{"learned":"..."},"reason":"...","idempotencyKey":"<uuid>"}' \
    "$NOVA_BASE_URL/api/agent/v1/proposals"

- Send only the fields you want to change. Use a new idempotencyKey per intended change and reuse it when retrying.
- Ratings (feedback ratings, review ratings) may only be proposed when Noah dictated them himself; then add "ratingsSource":"user-dictated". Never invent ratings.
- Proposals expire after 24 hours by default.
- Poll GET /proposals/<id>. Say a change is saved only when status is "executed". "rejected", "expired" or "cancelled" means do not retry without asking Noah. "failed" means propose again.
- An executed change is written to the database only. It reaches the spreadsheet when Noah runs the bulk sync, and a browser tab he left open may overwrite it on its next save.
