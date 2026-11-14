import type { JobPublisher } from "@atlas/adapter-kit";
import { memoryDreamJob } from "@atlas/adapter-kit";
import type { PrismaClient } from "@atlas/db";
import { getLogger } from "@atlas/logging";

const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MIN_RUNS_SINCE_LAST = 2;
const RUN_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/** Queue memory review after enough owner chat activity (proposals still need approval). */
export async function maybeScheduleMemoryDream(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  run: { spaceId: string; userId: string; botId: string; trigger: string; status: string },
): Promise<void> {
  if (run.status !== "completed" || run.trigger !== "user") return;

  const pending = await deps.prisma.memoryDream.findFirst({
    where: {
      spaceId: run.spaceId,
      userId: run.userId,
      botId: run.botId,
      status: { in: ["queued", "running"] },
    },
    select: { id: true },
  });
  if (pending) return;

  const lastReady = await deps.prisma.memoryDream.findFirst({
    where: {
      spaceId: run.spaceId,
      userId: run.userId,
      botId: run.botId,
      status: "ready",
    },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  if (lastReady && Date.now() - lastReady.updatedAt.getTime() < COOLDOWN_MS) return;

  const since = lastReady?.updatedAt ?? new Date(Date.now() - RUN_LOOKBACK_MS);
  const completedSince = await deps.prisma.run.count({
    where: {
      spaceId: run.spaceId,
      userId: run.userId,
      botId: run.botId,
      trigger: "user",
      status: "completed",
      completedAt: { gt: since },
    },
  });
  if (completedSince < MIN_RUNS_SINCE_LAST) return;

  const dream = await deps.prisma.memoryDream.create({
    data: {
      spaceId: run.spaceId,
      userId: run.userId,
      botId: run.botId,
      status: "queued",
    },
    select: { id: true },
  });
  await deps.jobs.enqueue(memoryDreamJob(dream.id)).catch((error) => {
    getLogger().error("memory.dream enqueue failed", error);
  });
}
