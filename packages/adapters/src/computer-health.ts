import type { JobPublisher, NotificationProvider } from "@atlas/adapter-kit";
import type { PrismaClient } from "@atlas/db";
import { asSystem } from "@atlas/db";
import { getLogger } from "@atlas/logging";
import { ComputerBusyError } from "./computer-lifecycle.js";
import { queueComputerUpdate } from "./computer-update.js";

/** Wait before each automatic recovery, counted from the error or the previous try. */
export const COMPUTER_RECOVERY_BACKOFF_MS = [5, 15, 45].map((minutes) => minutes * 60_000);
export const COMPUTER_RECOVERY_MAX_ATTEMPTS = COMPUTER_RECOVERY_BACKOFF_MS.length;
/** A computer that broke this long ago and has not run since starts over at the first try. */
const RECOVERY_RESET_MS = 24 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 60_000;
const BATCH = 50;
const PENDING_UPDATE_STATUSES = ["queued", "running", "reserving", "revoking", "revoked"];

type Deps = {
  prisma: PrismaClient;
  jobs: JobPublisher;
  notifications?: NotificationProvider;
  now?: () => number;
};

/**
 * Finds cloud computers stuck in `error`, queues a recover (stop, then start from the saved
 * home) with backoff, and tells the owner once when the tries run out. Never deletes a
 * computer, its home or its data.
 */
export function createComputerHealthSweeper(deps: Deps, options: { intervalMs?: number } = {}) {
  const intervalMs = options.intervalMs ?? SWEEP_INTERVAL_MS;
  const clock = deps.now ?? Date.now;
  let lastRun: number | undefined;
  return async () => {
    const now = clock();
    if (lastRun !== undefined && now - lastRun < intervalMs) return;
    lastRun = now;
    await sweepComputerHealth(deps, new Date(now));
  };
}

export async function sweepComputerHealth(deps: Deps, now: Date) {
  const prisma = asSystem(deps.prisma, "computer health sweep");
  // Running again means the computer works: the next failure gets the full set of tries.
  await prisma.computer.updateMany({
    where: {
      OR: [
        { state: "running" },
        {
          state: { not: "error" },
          healthRecoveryAt: { lt: new Date(now.getTime() - RECOVERY_RESET_MS) },
        },
      ],
      healthRecoveryAttempts: { gt: 0 },
    },
    data: { healthRecoveryAttempts: 0, healthRecoveryAt: null, healthAlertedAt: null },
  });
  const computers = await prisma.computer.findMany({
    where: {
      state: "error",
      kind: { not: "desktop" },
      healthAlertedAt: null,
      updatedAt: { lte: new Date(now.getTime() - COMPUTER_RECOVERY_BACKOFF_MS[0]!) },
      updates: { none: { status: { in: PENDING_UPDATE_STATUSES } } },
    },
    orderBy: { updatedAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      spaceId: true,
      userId: true,
      healthRecoveryAttempts: true,
      healthRecoveryAt: true,
      bots: {
        where: { archivedAt: null },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, name: true },
      },
    },
  });
  for (const computer of computers) {
    try {
      await checkComputer({ ...deps, prisma }, computer, now);
    } catch (error) {
      getLogger().error("computer health check", error);
    }
  }
}

type Candidate = {
  id: string;
  spaceId: string;
  userId: string;
  healthRecoveryAttempts: number;
  healthRecoveryAt: Date | null;
  bots: Array<{ id: string; name: string }>;
};

async function checkComputer(deps: Deps, computer: Candidate, now: Date) {
  const bot = computer.bots[0];
  if (!bot) return;
  const attempts = computer.healthRecoveryAttempts;
  const record = (attempt: number, outcome: string, error?: string) =>
    deps.prisma.computerHealthEvent.create({
      data: { computerId: computer.id, spaceId: computer.spaceId, attempt, outcome, error },
    });

  if (attempts >= COMPUTER_RECOVERY_MAX_ATTEMPTS) {
    const last = computer.healthRecoveryAt?.getTime() ?? 0;
    if (now.getTime() - last < COMPUTER_RECOVERY_BACKOFF_MS.at(-1)!) return;
    const claimed = await deps.prisma.computer.updateMany({
      where: { id: computer.id, healthAlertedAt: null },
      data: { healthAlertedAt: now },
    });
    if (!claimed.count) return;
    await record(attempts, "alerted");
    await alertOwner(deps, computer, bot);
    return;
  }

  if (attempts > 0) {
    const wait = COMPUTER_RECOVERY_BACKOFF_MS[attempts]!;
    if (now.getTime() - (computer.healthRecoveryAt?.getTime() ?? 0) < wait) return;
  }
  // Claim the try first so two workers never queue the same recovery.
  const claimed = await deps.prisma.computer.updateMany({
    where: { id: computer.id, healthRecoveryAttempts: attempts, state: "error" },
    data: { healthRecoveryAttempts: attempts + 1, healthRecoveryAt: now },
  });
  if (!claimed.count) return;
  try {
    await queueComputerUpdate(deps, computer.id, bot.id, "recover");
    await record(attempts + 1, "queued");
  } catch (error) {
    if (error instanceof ComputerBusyError) {
      // The user holds the computer: try again later without spending a try.
      await deps.prisma.computer.updateMany({
        where: { id: computer.id, healthRecoveryAttempts: attempts + 1 },
        data: { healthRecoveryAttempts: attempts },
      });
      await record(attempts + 1, "busy");
      return;
    }
    await record(attempts + 1, "failed", error instanceof Error ? error.message : String(error));
  }
}

async function alertOwner(deps: Deps, computer: Candidate, bot: { id: string; name: string }) {
  if (!deps.notifications) return;
  const thread = await deps.prisma.thread.findFirst({
    where: { botId: bot.id, userId: computer.userId, groupId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!thread) return;
  await deps.notifications
    .send(
      {
        kind: "computer",
        title: `${bot.name}\u2019s computer needs you`,
        body: "It stopped working and could not restart by itself. Open it to try again.",
        botId: bot.id,
        threadId: thread.id,
      },
      {
        operationId: "notify",
        traceId: computer.id,
        spaceId: computer.spaceId,
        userId: computer.userId,
        botId: bot.id,
        signal: new AbortController().signal,
      },
    )
    .catch((error) => getLogger().error("computer health notification", error));
}
