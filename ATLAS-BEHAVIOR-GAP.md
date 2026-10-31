# Atlas behavior gap audit

Target: Atlas behaves like a polished desktop assistant. It answers first and briefly, uses warm plain
language with labelled links, delegates long work, offers routines, keeps durable memory, confirms
before sending, asks before destructive or paid actions, treats outside content as untrusted, and
never invents facts.

Prompt budget matters. The default local model (qwen3.5 9B, 49K context) already spends about 10K
tokens on system guidance, so changes here trim or replace text instead of adding to it.

| Behavior | Status | Where | Notes |
| --- | --- | --- | --- |
| Answer first, briefly, warm plain sentences | Added (style clause) | `packages/adapters/src/run-instructions.ts` (`ATLAS_STYLE_GUIDANCE`) | One compact clause right after the bot's own instructions. |
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

- Trim the long `search_history` paragraph (~350 tokens). Postgres testkit and `executor.test.ts`
  assert its exact phrases, so it needs eval reruns: ~0.5 day.
- Max-tokens default from `RAKAZO_LOCAL_MAX_TOKENS` / `ATLAS_LOCAL_MAX_TOKENS`: needs a server-provided
  default surfaced to web onboarding, web model settings and mobile (`DEFAULT_MODEL_MAX_TOKENS` in
  `packages/core/src/domain.ts`): ~0.5 day.
- First-class journal (dated entries, "what did I do last week" summary): ~1?2 days.
- Paid-action detector (checkout and purchase tool names) on the mandatory gate: ~0.5 day.
- Persona eval suite against qwen3.5:9b-text (brevity, link format, routine offers): ~1 day.
