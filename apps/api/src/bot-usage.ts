import type { BotUsage } from "@atlas/contracts";
import type { PrismaClient } from "@atlas/db";
import { Prisma } from "@atlas/db";

/** Recent user-started runs the first-response median is taken over. */
const FIRST_RESPONSE_RUNS = 500;

type UsageGroup = {
  botId: string | null;
  _count: { _all: number };
  _sum: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  };
};

type FirstResponseRow = { botId: string; medianMs: number | null; runs: number };

/** Prompt tokens are uncached input plus both cache buckets. */
export function cachedShare(sum: UsageGroup["_sum"]): number | null {
  const read = sum.cacheReadTokens ?? 0;
  const prompt = (sum.inputTokens ?? 0) + read + (sum.cacheWriteTokens ?? 0);
  return prompt > 0 ? read / prompt : null;
}

/** Joins token groups, first-response medians and names into rows, busiest bot first. */
export function botUsageRows(
  groups: UsageGroup[],
  firstResponses: FirstResponseRow[],
  names: Map<string, { name: string; deleted: boolean }>,
): BotUsage[] {
  const latency = new Map(firstResponses.map((row) => [row.botId, row]));
  const rows = new Map<string, BotUsage>();
  for (const group of groups) {
    if (!group.botId) continue;
    const sum = group._sum;
    const input = sum.inputTokens ?? 0;
    const output = sum.outputTokens ?? 0;
    const read = sum.cacheReadTokens ?? 0;
    const first = latency.get(group.botId);
    const known = names.get(group.botId);
    rows.set(group.botId, {
      botId: group.botId,
      name: known?.name ?? null,
      ...(known?.deleted ? { deleted: true } : {}),
      modelCalls: group._count._all,
      totalTokens: sum.totalTokens ?? input + output + read + (sum.cacheWriteTokens ?? 0),
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: read,
      cachedShare: cachedShare(sum),
      firstResponseMs: first?.medianMs == null ? null : Math.round(first.medianMs),
      firstResponseRuns: first?.runs ?? 0,
    });
  }
  // A bot with replies but no recorded usage (e.g. a scripted runtime) still shows latency.
  for (const first of firstResponses) {
    if (rows.has(first.botId)) continue;
    const known = names.get(first.botId);
    rows.set(first.botId, {
      botId: first.botId,
      name: known?.name ?? null,
      ...(known?.deleted ? { deleted: true } : {}),
      modelCalls: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cachedShare: null,
      firstResponseMs: first.medianMs == null ? null : Math.round(first.medianMs),
      firstResponseRuns: first.runs,
    });
  }
  return [...rows.values()].sort(
    (a, b) => b.totalTokens - a.totalTokens || b.firstResponseRuns - a.firstResponseRuns,
  );
}

/**
 * First response: from the run's creation (the user's message) to the first thing
 * the user sees from the bot: a message, a tool call, or a question.
 */
async function firstResponses(
  prisma: Pick<PrismaClient, "$queryRaw">,
  spaceId: string,
  userId: string,
): Promise<FirstResponseRow[]> {
  const rows = await prisma.$queryRaw<{ botId: string; medianMs: number | null; runs: number }[]>(
    Prisma.sql`
      WITH recent AS (
        SELECT r.id, r."botId", r."createdAt" FROM runs r
        WHERE r."spaceId" = ${spaceId} AND r."userId" = ${userId} AND r.trigger = 'user'
        ORDER BY r."createdAt" DESC LIMIT ${FIRST_RESPONSE_RUNS}
      ), firsts AS (
        SELECT recent."botId",
          EXTRACT(EPOCH FROM (MIN(e."createdAt") - recent."createdAt")) * 1000 AS ms
        FROM recent JOIN events e ON e."runId" = recent.id
        WHERE e.type IN ('agent.tool.called', 'run.waiting_input')
          OR (e.type = 'thread.message.created' AND e.payload->>'role' <> 'user')
        GROUP BY recent.id, recent."botId", recent."createdAt"
      )
      SELECT "botId", percentile_cont(0.5) WITHIN GROUP (ORDER BY ms)::float8 AS "medianMs",
        COUNT(*)::int AS runs
      FROM firsts WHERE ms >= 0 GROUP BY "botId"`,
  );
  return rows.map((row) => ({
    botId: row.botId,
    medianMs: row.medianMs == null ? null : Number(row.medianMs),
    runs: Number(row.runs),
  }));
}

export async function loadBotUsage(
  prisma: Pick<PrismaClient, "$queryRaw" | "usageRecord" | "bot" | "botDeletion">,
  spaceId: string,
  userId: string,
): Promise<BotUsage[]> {
  const where = { spaceId, userId };
  const [groups, latency] = await Promise.all([
    prisma.usageRecord.groupBy({
      by: ["botId"],
      where,
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        cacheReadTokens: true,
        cacheWriteTokens: true,
      },
    }),
    firstResponses(prisma, spaceId, userId),
  ]);
  const ids = [
    ...new Set([
      ...groups.flatMap((group) => (group.botId ? [group.botId] : [])),
      ...latency.map((row) => row.botId),
    ]),
  ];
  const [bots, deletions] = await Promise.all([
    prisma.bot.findMany({ where: { spaceId, id: { in: ids } }, select: { id: true, name: true } }),
    prisma.botDeletion.findMany({
      where: { spaceId, id: { in: ids } },
      select: { id: true, name: true },
    }),
  ]);
  const names = new Map<string, { name: string; deleted: boolean }>();
  for (const row of deletions) names.set(row.id, { name: row.name, deleted: true });
  for (const row of bots) names.set(row.id, { name: row.name, deleted: false });
  return botUsageRows(groups as UsageGroup[], latency, names);
}
