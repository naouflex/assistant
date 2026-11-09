---
name: atlas-dev-handover
description: >-
  Draft and post handover summaries to Atlas dev bots in production (user
  message + queued run). Use when the user asks to update devs, hand off work,
  prepare or send a handover, or notify Atlas Dev / Strike Dev / other dev bots
  about shipped changes, infra, or open items.
---

# Atlas dev handover

Post a plain-language update into a **dev bot's main thread** so it gets a real
user message and a `run.continue` job — the same path as a human sending chat.

Scripts live next to this file. Resolve once:

```bash
SEND="$(git rev-parse --show-toplevel)/.agents/skills/atlas-dev-handover/send-handover.sh"
```

## When to use

- After meaningful **prod deploys**, **infra**, **bug fixes**, or **ops** the dev
  bot should know about.
- When the user says *handover*, *update the dev*, *tell Atlas Dev*, or similar.
- Do **not** use for secrets, tokens, passwords, or one-off customer data.

## Draft the message

Write for someone who lives in the repo and prod, not for a changelog commit.

1. **Title line** — e.g. `Handover #4 (topic, date window).`
2. **Code / deploy** — commit SHAs or PR themes; say whether **prod was verified**
   or only **pushed to origin**. Remind: deploy is **`upload` then `update`** (a
   worker restart kills an in-container deploy).
3. **Behavior changes** — what broke, what fixed, who was affected.
4. **Infra / ops** — computers, cluster, pairing, pins; only facts the dev needs.
5. **Open items** — what still needs the maintainer or the bot.

### Public / in-app rules (required)

The text appears in the product and in a public repo culture:

- No passwords, API keys, tokens, `.env` values, or **token hashes**.
- No personal hostnames, home LAN IPs, account emails, or local filesystem paths.
- No pasted tool output; describe results in words.
- Prefer bot names and product names over internal IDs unless debugging needs them.

Keep under ~400 words unless the change is migration- or security-heavy.

## Send

1. Save the draft to a temp file, e.g. `/tmp/handover.md`.
2. Run (default bot **Atlas Dev**):

```bash
chmod +x "$SEND"
"$SEND" /tmp/handover.md
```

3. Another dev bot:

```bash
ATLAS_BOT_NAME='Strike Dev' "$SEND" /tmp/handover.md
```

4. Tell the user the printed `run=` id and `status=` (usually `running` then
   `completed`). Delete the temp file if it contained anything sensitive.

### Bot name

`ATLAS_BOT_NAME` must match `bots.name` exactly (case-sensitive). Main thread is
the bot's non-group `threads` row (`groupId` null).

### Failures

| Symptom | Check |
|--------|--------|
| `post failed (no RUN id)` | `gcloud` auth, VM name, `atlas-prod-api-1` up |
| Bot not found | spelling of `ATLAS_BOT_NAME`, bot not archived |
| Run stuck `running` | worker logs; deploy may have restarted mid-handover |

## Agent workflow

```
- [ ] Gather facts (git log, deploy, prod checks, user context)
- [ ] Draft handover (template above + safety pass)
- [ ] User asked to send? → send-handover.sh
- [ ] Report run id; optional: wait for run completed if user wants confirmation
```

Optional: show the user the draft **before** send when the message is large or
includes operational risk.

## Example opening

```markdown
Handover #4 (sandbox cluster, since #3). Prod verified unless noted.

**Shipped to prod:**
- abc1234 — short what/why

**Infra:**
- …

**For you:**
- …
```
