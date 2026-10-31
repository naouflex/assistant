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
