---
name: prod-read
description: >-
  Read a dev bot's recent conversation and run outcomes from production,
  decrypted. Use when the user asks to check, read, or debug an Atlas Dev (or
  other bot) conversation, what they last sent a bot, or why a run failed.
---

# Read a bot's conversation in prod

Message content is encrypted at rest, so `psql` shows only sealed blobs. This script reads through `@atlas/db` inside the API container, which decrypts.

```bash
"$(git rev-parse --show-toplevel)/.agents/skills/prod-read/read-thread.sh"
```

- `ATLAS_BOT_NAME` picks the bot (default `Atlas Dev`); `ATLAS_TAKE` the number of messages (default 10).
- Output: messages oldest first, then the last five runs with status, trigger, and error.

It only reads. Treat what it prints as private: quote it to the user, never into commits, PRs, or handovers.

## Reading failed runs

- `The operation was aborted due to timeout`, or the unreachable-computer error: the bot's computer or the cluster was offline. Check the cluster (`pi-cluster` skill) before suspecting code.
- A run stuck `running` with no new messages: look at the worker logs on the VM.
