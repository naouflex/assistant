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
| Approval cards for risky shell commands | Shell commands only asked when the bot's approval mode said so; "Never ask" ran `rm -rf` silently | 0e804a9d: `riskyShellCommand` (rm -rf, force push, reset --hard, sudo, DROP/TRUNCATE, mkfs/dd, chmod -R /, curl\|sh) always shows "Run this risky command? It ..." with Allow once / Deny, in every mode. Message sends now always ask too (closes the "Never ask" send gap). |
| Draft-before-send cards | Sends had a confirm card with the body as read-only detail | 04c03531: send cards show To / Cc / Subject / Message fields you can edit, with Send and Discard. Edits are checked against the card's own fields and rewrite the stored request before replay. No card is editable when a value holds a secret. |
| Routines list UI | Per-bot routine list in the bot side panel only | 31519aa1: /app/routines (sidebar menu > Routines) lists every bot's routines with next run, last run, Pause/Resume, Edit (opens the bot's routine editor), Delete. |

Also this round: prompt-cache reuse (b9346f1f, 87ba8ec0): stable system+tools prefix, history as real turns, volatile context last; repeated questions keep their order on warm turns. Warm turn 2 reuses ~4.8-4.9K of ~5.2K prompt tokens.

### Round 3 candidates
1. Interactive option cards (bot offers 2-4 choices; one tap answers).
2. Local model auto-discovery in the model picker (Ollama /api/tags and llama-server /v1/models).
3. Usage view per bot (tokens, cached share, time to first token).

## Round 3 (2026-10-31)

| Planned | Found | Shipped |
|---|---|---|
| Interactive option cards | Already there: ask_user with options renders lettered rows (A, B, C...); one tap answers; a typed reply still works. | Swap: 65717013 adds keyboard answers: press A-D or 1-4 to pick an option of the newest open question (ignored while typing in a field, with modifiers, or when a dialog is open). |
| Local model auto-discovery | Local models came only from ATLAS_LOCAL_MODELS | 44d1bc9f: API and worker scan the local server's /v1/models (and Ollama's /api/tags, default 127.0.0.1:11434) at start and every 60s; new models show in the picker under "Local (Ollama / llama.cpp / LM Studio)". Configured ids keep priority. ATLAS_LOCAL_DISCOVERY_URLS adds servers, or "off" turns it off. |
| Usage view per bot | Usage settings showed totals by day and model | 6747eabb: Settings > Usage has a "by bot" table: tokens, share served from cache, median time to first response (last 500 user runs). |

Time to first response (llama-server MTP on 11436, monotonic clock): direct API 165-290 ms warm (1.2-1.6 s cold or for a new 2.4K-token prefix; cached prefix 2422/2440 tokens). Through Atlas, send to first visible bot event: median ~1.4 s (1.0-2.7 s, 8 runs).

### Round 4 candidates
1. Streamed reply text in the thread (first token visible before the whole message lands).
2. Model picker refresh button and per-model health (reachable, context size from /props).
3. Make the bot reach for option cards: a prompt or tool-hint tweak so 2-4 way choices come out as ask_user options, plus an eval case.

## Round 4 (2026-10-31)
- d5b79ba4 Streaming: reply text already streamed, but only when the preference was explicitly on; now on by default (Settings > "Stream replies" still turns it off).
- 424484a5 Model picker: refresh button (refresh-local-models) plus per-local-model notes: offline, context size (e.g. "16K ctx", or "8K ctx, Atlas sends 32K" on mismatch), "slow on 8 GB GPU" for models > 7 GiB or >= 14B. New RPC models.localStatus({refresh}).
- 5f59e8a4 Testkit: models/localStatus added to the unauthenticated RPC sweep.
- d17a689a Option cards: per-turn ask_user note when the user asks to choose/get options (EN + FR), compact guidance updated, eval cases ask-choice-three-way / ask-choice-open. Live on qwen3.5:4b-mtp: 2/6 -> 8/8 runs ended in ask_user.
- Scoped down: worker re-scans on its own 60 s timer only; Ollama context shown only for loaded models; GPU flag is a static size heuristic; ask_user tool description unchanged (30.5 KB tool-definition budget).
