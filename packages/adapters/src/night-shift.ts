import type {
  NightShiftLogEntry,
  NightShiftTimeline,
  NightShiftTotals,
  RunStatus,
  RunTrigger,
} from "@atlas/contracts";
import { NIGHT_SHIFT_HANDOFF_TRIGGERS } from "@atlas/contracts";
import { ACTIVE_RUN_STATUSES } from "@atlas/core";
import type { PrismaClient } from "@atlas/db";

/** Row caps per source; a window that hits one is reported as truncated. */
const RUN_LIMIT = 2_000;
const EFFECT_LIMIT = 5_000;
const USAGE_LIMIT = 20_000;
const EVENT_LIMIT = 2_000;
const LOG_LIMIT = 600;

const HANDOFF_TRIGGERS = new Set<string>(NIGHT_SHIFT_HANDOFF_TRIGGERS);
const ACTIVE = new Set<string>(ACTIVE_RUN_STATUSES);

export type NightShiftScope = { spaceId: string; userId: string };

function usageTokens(row: {
  totalTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}): number {
  if (row.totalTokens != null) return row.totalTokens;
  return (
    (row.inputTokens ?? 0) +
    (row.outputTokens ?? 0) +
    (row.cacheReadTokens ?? 0) +
    (row.cacheWriteTokens ?? 0)
  );
}

/**
 * Aggregates real activity in one window: runs (desks, shipped, handoffs), external
 * effects (actions decided without the user), waiting-input events (needed you),
 * usage records (tokens) and compaction usage (naps).
 */
export async function loadNightShift(
  prisma: PrismaClient,
  scope: NightShiftScope,
  window: { from: Date; to: Date; bucketMinutes: number },
): Promise<NightShiftTimeline> {
  const { from, to } = window;
  const bucketMs = window.bucketMinutes * 60_000;
  const where = { spaceId: scope.spaceId, userId: scope.userId };

  const [bots, runs, usage] = await Promise.all([
    prisma.bot.findMany({
      where: { ...where, archivedAt: null },
      select: { id: true, name: true, color: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.run.findMany({
      where: {
        ...where,
        createdAt: { lte: to },
        OR: [{ completedAt: null }, { completedAt: { gte: from } }],
      },
      select: {
        id: true,
        botId: true,
        status: true,
        trigger: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        updatedAt: true,
        routine: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: RUN_LIMIT,
    }),
    prisma.usageRecord.findMany({
      where: { ...where, createdAt: { gte: from, lte: to } },
      select: {
        botId: true,
        runId: true,
        agentId: true,
        operationId: true,
        operationKind: true,
        createdAt: true,
        totalTokens: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
      },
      orderBy: { createdAt: "asc" },
      take: USAGE_LIMIT,
    }),
  ]);
  const botIds = new Set(bots.map((bot) => bot.id));
  const ownRunIds = runs.map((run) => run.id);
  const runBot = new Map(runs.map((run) => [run.id, run.botId]));

  const [effects, waits] = await Promise.all([
    prisma.externalEffect.findMany({
      where: {
        spaceId: scope.spaceId,
        run: { userId: scope.userId },
        status: "completed",
        updatedAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        runId: true,
        kind: true,
        reviewDecision: true,
        updatedAt: true,
        run: { select: { botId: true } },
      },
      orderBy: { updatedAt: "asc" },
      take: EFFECT_LIMIT,
    }),
    ownRunIds.length === 0
      ? Promise.resolve([])
      : prisma.event.findMany({
          where: {
            spaceId: scope.spaceId,
            type: "run.waiting_input",
            runId: { in: ownRunIds },
            createdAt: { gte: from, lte: to },
          },
          select: { runId: true, botId: true, createdAt: true },
          orderBy: { createdAt: "asc" },
          take: EVENT_LIMIT,
        }),
  ]);

  const bucketCount = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / bucketMs));
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    start: new Date(from.getTime() + index * bucketMs).toISOString(),
    shipped: 0,
    handoffs: 0,
    decided: 0,
    tokens: 0,
    activeRuns: 0,
  }));
  const bucketAt = (at: Date) => {
    const index = Math.floor((at.getTime() - from.getTime()) / bucketMs);
    return index >= 0 && index < bucketCount ? buckets[index] : undefined;
  };
  const inWindow = (at: Date) => at >= from && at <= to;
  const log: NightShiftLogEntry[] = [];
  const totals: NightShiftTotals = {
    shipped: 0,
    handoffs: 0,
    decided: 0,
    neededYou: 0,
    failed: 0,
    naps: 0,
    tokens: 0,
  };

  const spans = runs
    .filter((run) => botIds.has(run.botId))
    .map((run) => {
      const start = run.startedAt ?? run.createdAt;
      const active = ACTIVE.has(run.status);
      const end = active ? null : (run.completedAt ?? run.updatedAt);
      const startBucket = Math.max(0, Math.floor((start.getTime() - from.getTime()) / bucketMs));
      const endTime = (end ?? to).getTime();
      const endBucket = Math.min(
        bucketCount - 1,
        Math.floor((endTime - from.getTime()) / bucketMs),
      );
      for (let index = startBucket; index <= endBucket; index++) {
        const bucket = buckets[index];
        if (bucket) bucket.activeRuns++;
      }
      if (inWindow(start) && run.trigger === "routine") {
        log.push({
          at: start.toISOString(),
          botId: run.botId,
          kind: "routine",
          detail: run.routine?.name ?? null,
          runId: run.id,
        });
      }
      if (inWindow(start) && HANDOFF_TRIGGERS.has(run.trigger)) {
        totals.handoffs++;
        const bucket = bucketAt(start);
        if (bucket) bucket.handoffs++;
        log.push({
          at: start.toISOString(),
          botId: run.botId,
          kind: "handoff",
          detail: run.trigger,
          runId: run.id,
        });
      }
      if (end && inWindow(end) && run.status === "completed") {
        totals.shipped++;
        const bucket = bucketAt(end);
        if (bucket) bucket.shipped++;
        log.push({
          at: end.toISOString(),
          botId: run.botId,
          kind: "shipped",
          detail: run.routine?.name ?? run.trigger,
          runId: run.id,
        });
      }
      if (end && inWindow(end) && run.status === "failed") {
        totals.failed++;
        log.push({
          at: end.toISOString(),
          botId: run.botId,
          kind: "failed",
          detail: null,
          runId: run.id,
        });
      }
      return {
        runId: run.id,
        botId: run.botId,
        status: run.status as RunStatus,
        trigger: run.trigger as RunTrigger,
        routineName: run.routine?.name ?? null,
        start: start.toISOString(),
        end: end ? end.toISOString() : null,
      };
    });

  for (const effect of effects) {
    // "ask" means the gate stopped for the user's approval; anything else ran on its own.
    if (effect.reviewDecision === "ask") continue;
    totals.decided++;
    const bucket = bucketAt(effect.updatedAt);
    if (bucket) bucket.decided++;
    log.push({
      at: effect.updatedAt.toISOString(),
      botId: effect.run.botId,
      kind: "decided",
      detail: effect.kind,
      runId: effect.runId,
    });
  }

  for (const wait of waits) {
    totals.neededYou++;
    log.push({
      at: wait.createdAt.toISOString(),
      botId: wait.botId,
      kind: "needed_you",
      detail: null,
      runId: wait.runId,
    });
  }

  const subagents = new Set<string>();
  for (const row of usage) {
    const tokens = usageTokens(row);
    totals.tokens += tokens;
    const bucket = bucketAt(row.createdAt);
    if (bucket) bucket.tokens += tokens;
    const botId = row.botId ?? (row.runId ? runBot.get(row.runId) : undefined) ?? null;
    if (row.operationKind === "compaction") {
      totals.naps++;
      log.push({
        at: row.createdAt.toISOString(),
        botId,
        kind: "nap",
        detail: null,
        runId: row.runId,
      });
    }
    if (row.operationKind === "subagent") {
      const key = row.agentId ?? row.operationId ?? `${row.runId}:${row.createdAt.getTime()}`;
      if (!subagents.has(key)) {
        subagents.add(key);
        totals.handoffs++;
        if (bucket) bucket.handoffs++;
        log.push({
          at: row.createdAt.toISOString(),
          botId,
          kind: "handoff",
          detail: "subagent",
          runId: row.runId,
        });
      }
    }
  }

  log.sort((a, b) => a.at.localeCompare(b.at));
  const truncated =
    runs.length >= RUN_LIMIT ||
    effects.length >= EFFECT_LIMIT ||
    usage.length >= USAGE_LIMIT ||
    waits.length >= EVENT_LIMIT ||
    log.length > LOG_LIMIT;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    bucketMinutes: window.bucketMinutes,
    bots: bots.map((bot) => ({ id: bot.id, name: bot.name, color: bot.color ?? null })),
    spans,
    log: log.slice(-LOG_LIMIT),
    buckets,
    totals,
    truncated,
  };
}

/** Hours before a routine fires that its Night Shift report covers. */
export const NIGHT_SHIFT_REPORT_HOURS = 12;

/** Plain-text report of one window, for a routine prompt. Facts only. */
export function nightShiftReportText(timeline: NightShiftTimeline, timezone: string): string {
  const names = new Map(timeline.bots.map((bot) => [bot.id, bot.name]));
  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso));
    } catch {
      return iso.slice(11, 16);
    }
  };
  const t = timeline.totals;
  const lines = [
    `Night Shift report, ${timeline.from} to ${timeline.to} (times in ${timezone}).`,
    `Totals: ${t.shipped} shipped, ${t.handoffs} handoffs, ${t.decided} actions decided without approval, ${t.neededYou} times a bot needed the user, ${t.failed} failed runs, ${t.naps} context compactions (naps), ${t.tokens} tokens.`,
  ];
  const perBot = new Map<string, Map<string, number>>();
  for (const entry of timeline.log) {
    const name = (entry.botId && names.get(entry.botId)) || "Unknown bot";
    const counts = perBot.get(name) ?? new Map<string, number>();
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
    perBot.set(name, counts);
  }
  for (const [name, counts] of perBot) {
    lines.push(`- ${name}: ${[...counts].map(([kind, n]) => `${n} ${kind}`).join(", ")}`);
  }
  const notable = timeline.log.filter((entry) => entry.kind !== "decided").slice(-40);
  if (notable.length > 0) lines.push("Log:");
  for (const entry of notable) {
    const name = (entry.botId && names.get(entry.botId)) || "Unknown bot";
    lines.push(
      `${when(entry.at)} ${name} ${entry.kind}${entry.detail ? ` (${entry.detail})` : ""}`,
    );
  }
  if (timeline.log.length === 0) lines.push("No activity was recorded in this window.");
  if (timeline.truncated) lines.push("Note: the window hit a row limit; totals are a lower bound.");
  return lines.join("\n");
}
