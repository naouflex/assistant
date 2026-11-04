import * as z from "zod";
import { Id, IsoDate, RunStatus } from "./ids.js";
import { RunTriggerSchema } from "./runs.js";

/** Longest window the Night Shift timeline aggregates in one request. */
export const NIGHT_SHIFT_MAX_WINDOW_MS = 48 * 60 * 60_000;

/** Run triggers that count as one bot handing work to another. */
export const NIGHT_SHIFT_HANDOFF_TRIGGERS = ["spawn", "bot_message", "cloud_agent"] as const;

/**
 * A routine prompt containing this marker gets the overnight Night Shift report
 * appended when it fires. The Agent Times routine uses it.
 */
export const NIGHT_SHIFT_REPORT_MARKER = "{{night_shift_report}}";

export const AGENT_TIMES_ROUTINE_NAME = "The Agent Times";

export const AGENT_TIMES_ROUTINE_PROMPT = `Write this morning's edition of "The Agent Times", a short newspaper-style digest of what my bots did overnight.
Use only the facts in the Night Shift report below. Do not invent work that is not in it.
Lead with a one-line headline, then a few short items: what shipped, handoffs between bots, actions taken without my approval, anything that failed or needs me, and token spend.
If the report shows no overnight activity, say so in one line.

${NIGHT_SHIFT_REPORT_MARKER}`;

export const NightShiftInputSchema = z
  .object({
    from: IsoDate,
    to: IsoDate,
    bucketMinutes: z.number().int().min(1).max(120).default(15),
  })
  .refine((v) => {
    const span = Date.parse(v.to) - Date.parse(v.from);
    return span > 0 && span <= NIGHT_SHIFT_MAX_WINDOW_MS;
  }, "The window must be positive and at most 48 hours.");
export type NightShiftInput = z.infer<typeof NightShiftInputSchema>;

export const NightShiftBotSchema = z.object({
  id: Id,
  name: z.string(),
  color: z.string().nullable(),
});

export const NightShiftSpanSchema = z.object({
  runId: Id,
  botId: Id,
  status: RunStatus,
  trigger: RunTriggerSchema,
  routineName: z.string().nullable(),
  start: IsoDate,
  /** Null while the run is still active. */
  end: IsoDate.nullable(),
});

export const NightShiftLogKindSchema = z.enum([
  "shipped",
  "failed",
  "handoff",
  "decided",
  "needed_you",
  "nap",
  "routine",
]);
export type NightShiftLogKind = z.infer<typeof NightShiftLogKindSchema>;

export const NightShiftLogEntrySchema = z.object({
  at: IsoDate,
  botId: Id.nullable(),
  kind: NightShiftLogKindSchema,
  /** Effect kind, routine name or trigger, depending on `kind`. */
  detail: z.string().nullable(),
  runId: Id.nullable(),
});
export type NightShiftLogEntry = z.infer<typeof NightShiftLogEntrySchema>;

export const NightShiftBucketSchema = z.object({
  start: IsoDate,
  shipped: z.number().int(),
  handoffs: z.number().int(),
  decided: z.number().int(),
  tokens: z.number().int(),
  activeRuns: z.number().int(),
});

export const NightShiftTotalsSchema = z.object({
  shipped: z.number().int(),
  handoffs: z.number().int(),
  decided: z.number().int(),
  neededYou: z.number().int(),
  failed: z.number().int(),
  naps: z.number().int(),
  tokens: z.number().int(),
});
export type NightShiftTotals = z.infer<typeof NightShiftTotalsSchema>;

export const NightShiftTimelineSchema = z.object({
  from: IsoDate,
  to: IsoDate,
  bucketMinutes: z.number().int(),
  bots: z.array(NightShiftBotSchema),
  spans: z.array(NightShiftSpanSchema),
  log: z.array(NightShiftLogEntrySchema),
  buckets: z.array(NightShiftBucketSchema),
  totals: NightShiftTotalsSchema,
  /** True when a row limit cut the window short, so totals are a lower bound. */
  truncated: z.boolean(),
});
export type NightShiftTimeline = z.infer<typeof NightShiftTimelineSchema>;
export type NightShiftSpan = z.infer<typeof NightShiftSpanSchema>;
export type NightShiftBot = z.infer<typeof NightShiftBotSchema>;

export const AgentTimesSchema = z.object({
  routine: z
    .object({
      id: Id,
      botId: Id,
      active: z.boolean(),
      crons: z.array(z.string()),
      timezone: z.string(),
      nextRunAt: IsoDate.nullable(),
    })
    .nullable(),
  /** The latest edition the routine produced, if any. */
  edition: z
    .object({
      runId: Id,
      botId: Id,
      threadId: Id,
      publishedAt: IsoDate,
      text: z.string(),
    })
    .nullable(),
});
export type AgentTimes = z.infer<typeof AgentTimesSchema>;
