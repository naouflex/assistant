import { runContinueJob } from "@atlas/adapter-kit";
import { ACTIVE_RUN_STATUSES } from "@atlas/core";
import type { JobPublisher } from "@atlas/adapter-kit";
import type { PrismaClient } from "@atlas/db";
import { getLogger } from "@atlas/logging";

/** Crash recovery only. A finished parent releases helpers immediately. */
export const BACKGROUND_WAKE_DELAY_MS = 2 * 60 * 1000;

export function helperMayStartAnother(parentTrigger: string): boolean {
  return parentTrigger !== "follow_up";
}

export function backgroundHelperClientNonce(parentRunId: string, executionId: string): string {
  return `background:${parentRunId}:${executionId}`;
}

export function backgroundParentRunId(clientNonce: string | null | undefined): string | undefined {
  const match = /^background:([^:]+):/.exec(clientNonce ?? "");
  return match?.[1];
}

/** A helper stays queued while the turn that created it is still going. */
export async function helperParentStillRunning(
  deps: { prisma: PrismaClient },
  clientNonce: string | null | undefined,
): Promise<boolean> {
  const parentId = backgroundParentRunId(clientNonce);
  if (!parentId) return false;
  const parent = await deps.prisma.run.findUnique({
    where: { id: parentId },
    select: { status: true },
  });
  return parent != null && (ACTIVE_RUN_STATUSES as readonly string[]).includes(parent.status);
}

/** Queue a follow_up run that starts after the parent turn finishes. */
export async function queueBackgroundHelper(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  input: {
    parentRun: {
      id: string;
      spaceId: string;
      userId: string;
      botId: string;
      threadId: string;
      sourceMessageId: string | null;
      status: string;
      trigger: string;
    };
    name: string;
    task: string;
    instructions?: string;
    executionId: string;
  },
): Promise<{ ok: true; helperRunId: string } | { error: string }> {
  if (input.parentRun.status !== "running") {
    return { error: "Parent run is no longer active." };
  }
  if (!helperMayStartAnother(input.parentRun.trigger)) {
    return { error: "A follow-up run cannot start a background helper." };
  }
  const clientNonce = backgroundHelperClientNonce(input.parentRun.id, input.executionId);
  const existing = await deps.prisma.run.findFirst({
    where: { spaceId: input.parentRun.spaceId, clientNonce },
    select: { id: true },
  });
  if (existing) return { ok: true, helperRunId: existing.id };

  const label = input.name.trim().slice(0, 80) || "helper";
  const body = [input.instructions?.trim(), input.task.trim()].filter(Boolean).join("\n\n");
  const prompt = [
    `You queued background work as "${label}" while answering the owner.`,
    "Complete it now, then tell the owner the outcome in one or two sentences in your reply.",
    "",
    body.slice(0, 8000) || "Complete the delegated task.",
  ].join("\n");
  const wakeAt = new Date(Date.now() + BACKGROUND_WAKE_DELAY_MS);

  const task = await deps.prisma.task.create({
    data: {
      spaceId: input.parentRun.spaceId,
      botId: input.parentRun.botId,
      threadId: input.parentRun.threadId,
      userId: input.parentRun.userId,
      prompt,
      status: "queued",
    },
  });
  const helper = await deps.prisma.run.create({
    data: {
      spaceId: input.parentRun.spaceId,
      botId: input.parentRun.botId,
      threadId: input.parentRun.threadId,
      userId: input.parentRun.userId,
      taskId: task.id,
      status: "queued",
      trigger: "follow_up",
      sourceMessageId: input.parentRun.sourceMessageId,
      clientNonce,
      wakeAt,
    },
    select: { id: true },
  });
  return { ok: true, helperRunId: helper.id };
}

/** Drop helpers that never started because the parent failed or was cancelled. */
export async function cancelQueuedBackgroundHelpers(
  deps: { prisma: PrismaClient },
  parentRunId: string,
): Promise<void> {
  const prefix = `background:${parentRunId}:`;
  const helpers = await deps.prisma.run.findMany({
    where: { clientNonce: { startsWith: prefix }, status: "queued" },
    select: { id: true },
  });
  if (helpers.length === 0) return;
  await deps.prisma.run.updateMany({
    where: { id: { in: helpers.map((helper) => helper.id) }, status: "queued" },
    data: { status: "cancelled", wakeAt: null },
  });
}

/** Start queued background helpers once the parent turn is done. */
export async function releaseBackgroundHelpers(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  parentRunId: string,
): Promise<void> {
  const prefix = `background:${parentRunId}:`;
  const helpers = await deps.prisma.run.findMany({
    where: { clientNonce: { startsWith: prefix }, status: "queued" },
    select: { id: true },
  });
  for (const helper of helpers) {
    await deps.prisma.run.update({
      where: { id: helper.id },
      data: { wakeAt: new Date() },
    });
    await deps.jobs.enqueue(runContinueJob(helper.id)).catch((error) => {
      getLogger().error("background helper release enqueue failed", error);
    });
  }
}
