# Atlas behavior gap audit

Target: Atlas behaves like a polished desktop assistant. It answers first and briefly, uses warm plain
language with labelled links, delegates long work, offers routines, keeps durable memory, confirms
before sending, asks before destructive or paid actions, treats outside content as untrusted, and
never invents facts.

Prompt budget matters. The default local model (qwen3.5 9B, 49K context) already spends about 10K
tokens on system guidance, so changes here trim or replace text instead of adding to it.

| Behavior | Status | Where | Notes |
| --- | --- | --- | --- |
| Answer first, briefly, warm plain sentences | Added (style clause) | `packages/adapters/src/run-instructions.ts` (`ATLAS_STYLE_GUIDANCE`) | Questions answer first; do-it/run/show/fix use tools first. |
| Labelled markdown links | Added (style clause) | same | Use `[label](url)`, never bare URLs. |
| Never invent facts | Partial ? added | same; "Prefer tools over claiming you already did the work" already existed | Now explicit: say what you don't know. |
| Background workers + milestone updates | Exists | `run_subagent`, `spawn_bot`, `message_bot`, ticket/background triggers; `packages/adapters/src/run-replies.ts` (`longWorkProgressGuidance`, `runReplyGuidance`) | message_user progress, capped at 500 chars. |
| Offer routines proactively | Partial ? added | `schedule_create/list/update/cancel`; triggers in `packages/core/src/domain.ts` (~538) | Prompt now tells the bot to offer `schedule_create` for recurring or time-based requests. |
| Durable memory: profile facts | Exists | `remember`, `recall_memory`; `redactedMemoryContext` injected each turn | Line strengthened: owner preferences, people, projects, decisions. |
| Dated journal | Partial | same tools | Notes about events are prefixed with a `YYYY-MM-DD` date so memory doubles as a journal. A real journal store (separate table, daily rollup, UI) is **missing**: ~1?2 days. |
| Confirm before sending | Added (hard gate) | `packages/core/src/action-approval.ts` (`connectorToolSendsMessage`), `packages/adapters/src/run-tool-gate.ts` (`requiresMandatoryApproval`) | Connector send/reply/forward/post/DM/SMS tools always raise an approval card in ask/auto mode, bypassing Auto Review and always-allow rules. Drafts are exempt. In explicit **Never ask** mode the owner's choice still wins. |
| Ask before destructive or paid actions | Exists (gate) + prompt | `planActionGate`, `MUTATING_CONNECTOR_PATTERN`, `toolRequiresApproval` | Prompt clause added. No purchase-specific detector: ~0.5 day. |
| Untrusted tool and web content | Exists | `userTurnInstructions` untrusted-data clause; browser clause | No change needed. |
| Replay prior replies as assistant turns | Fixed | `packages/adapters/src/pi-runtime.ts` (`toHistory`), `runtime-context.ts` | Small models had been treating earlier replies as user text. |
| update_bot combined-update rejection | Fixed | `packages/adapters/src/run-tool-request.ts` | The error now says nothing was saved and gives the exact retry. |

## Still missing (estimates)

- Max-tokens default from connection UI still uses `DEFAULT_MODEL_MAX_TOKENS` (4096); local server
  default is now 8192 via `ATLAS_LOCAL_MAX_TOKENS` in `.env.example` and `pi-local-provider.ts`.
- First-class journal (dated entries, "what did I do last week" summary): ~1?2 days.
- Paid-action detector (checkout and purchase tool names) on the mandatory gate: ~0.5 day.
- Persona eval suite against qwen3.5:9b-text with an LLM judge (brevity, link format): ~1 day; tool-choice
  guards now include Grok-style actions and lazy-tool finds.

## Local speed (added)

- Compact local mode: `compactUserTurnInstructions` and `compactToolSet` (packages/adapters/src/run-instructions.ts,
  builtin-tool-bridge.ts), on for the `local` provider; `ATLAS_LOCAL_COMPACT_PROMPT=false|always`.
  Same Debug-probe request on qwen3.5: 9,857 prompt tokens with the full prompt (26 tools) vs 2,649 compact (12 tools).
- Prefix cache: the system prompt and tools are byte-stable across turns; the date line is on the user message.
- `max_tokens` is mirrored from `max_completion_tokens` for local and OpenAI-compatible servers;
  `ATLAS_LOCAL_DISABLE_THINKING=true` sends `think:false`, `reasoning_effort:"none"`, `chat_template_kwargs.enable_thinking:false`.
- Not done: a per-connection thinking toggle in the UI (env only for now, ~0.5 day).
- Compact local: `attachAfterWrite` runtime nudge after `write_file` (`attach-after-write.ts`,
  `pi-runtime.ts`); shorter `attach_file` / `write_file` / `shell` tool blurbs; trimmed
  `HISTORY_RETRIEVAL_GUIDANCE`; deduped `COMPACT_CORE_GUIDANCE`.
