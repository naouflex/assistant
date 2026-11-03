import { runContinueJob } from "@atlas/adapter-kit";
import type { JobPublisher } from "@atlas/adapter-kit";
import type { PrismaClient } from "@atlas/db";
import { getLogger } from "@atlas/logging";

const BACKGROUND_WAKE_DELAY_MS = 24 * 60 * 60 * 1000;

export function backgroundHelperClientNonce(parentRunId: string, executionId: string): string {
  return `background:${parentRunId}:${executionId}`;
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
