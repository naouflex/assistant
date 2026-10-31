# Atlas roadmap loop

## Round 1 (2026-10-31)

| Planned | Found | Shipped |
|---|---|---|
| Instant ack + live tool status line | Already there: a "Working?" line shows as soon as a run starts, and the runtime replaces it with the current tool ("Searching the web?", "Running a command?") with no model tokens (pi-runtime `describeToolActivity`). | Swap: the working line now shows how long the current step has run (after 3s: "12s", "1m 05s"). |
| Memory panel (per-bot view/edit/delete) + dated journal | Already there: bot panel > Memory (KnowledgeSection) lists, opens, edits, downloads and deletes each memory note; Scratchpad sits above it. | Swap: each memory note shows the date it was last updated. A runtime-written daily journal was scoped out: memory notes feed the prompt, and an auto journal would grow the small-model prompt. |
| Emoji react tool shown as a pill | User reactions exist (hover a message, pick one of 6 emoji). There is no bot-side reaction path: the store only takes user reactions, and each one can start a turn. | Deferred: needs a bot-authored reaction message type plus a deferred tool; not in the compact set. |

### Round 2 candidates
1. Approval cards for risky shell commands.
2. Draft-before-send cards.
3. Routines list UI.

## Round 2 (2026-10-31)

| Planned | Found | Shipped |
|---|---|---|
| Approval cards for risky shell commands | Shell commands only asked when the bot's approval mode said so; "Never ask" ran `rm -rf` silently | 0e804a9d: `riskyShellCommand` (rm -rf, force push, reset --hard, sudo, DROP/TRUNCATE, mkfs/dd, chmod -R /, curl\|sh) always shows "Run this risky command? It ?" with Allow once / Deny, in every mode. Message sends now always ask too (closes the "Never ask" send gap). |
| Draft-before-send cards | Sends had a confirm card with the body as read-only detail | 04c03531: send cards show To / Cc / Subject / Message fields you can edit, with Send and Discard. Edits are checked against the card's own fields and rewrite the stored request before replay. No card is editable when a value holds a secret. |
| Routines list UI | Per-bot routine list in the bot side panel only | 31519aa1: /app/routines (sidebar menu > Routines) lists every bot's routines with next run, last run, Pause/Resume, Edit (opens the bot's routine editor), Delete. |

Also this round: prompt-cache reuse (b9346f1f, 87ba8ec0): stable system+tools prefix, history as real turns, volatile context last; repeated questions keep their order on warm turns. Warm turn 2 reuses ~4.8-4.9K of ~5.2K prompt tokens.

### Round 3 candidates
1. Interactive option cards (bot offers 2-4 choices; one tap answers).
2. Local model auto-discovery in the model picker (Ollama /api/tags and llama-server /v1/models).
3. Usage view per bot (tokens, cached share, time to first token).
