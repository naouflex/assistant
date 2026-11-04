import { loadNightShift } from "@atlas/adapters";
import type { MessageBlock } from "@atlas/contracts";
import { NIGHT_SHIFT_REPORT_MARKER } from "@atlas/contracts";
import { blocksToAgentHistoryText } from "@atlas/core";
import type { RouterContext } from "./context.js";

/** Longest edition text the page shows; the full one stays in the chat. */
const EDITION_TEXT_MAX = 8_000;

export function nightShiftRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    nightShift: {
      timeline: authed.nightShift.timeline.handler(async ({ context, input }) =>
        loadNightShift(
          deps.prisma,
          { spaceId: context.actor.spaceId, userId: context.actor.userId },
          {
            from: new Date(input.from),
            to: new Date(input.to),
            bucketMinutes: input.bucketMinutes,
          },
        ),
      ),
      agentTimes: authed.nightShift.agentTimes.handler(async ({ context }) => {
        const { spaceId, userId } = context.actor;
        const routine = await deps.prisma.routine.findFirst({
          where: {
            spaceId,
            userId,
            prompt: { contains: NIGHT_SHIFT_REPORT_MARKER },
            bot: { archivedAt: null },
          },
          orderBy: [{ active: "desc" }, { updatedAt: "desc" }],
        });
        if (!routine) return { routine: null, edition: null };
        const run = await deps.prisma.run.findFirst({
          where: { spaceId, routineId: routine.id, status: "completed" },
          orderBy: { completedAt: "desc" },
          select: { id: true, botId: true, threadId: true, completedAt: true, updatedAt: true },
        });
        const message = run
          ? await deps.prisma.message.findFirst({
              where: { threadId: run.threadId, runId: run.id, role: "bot" },
              orderBy: { seq: "desc" },
              select: { blocks: true },
            })
          : null;
        const text = message
          ? blocksToAgentHistoryText(message.blocks as unknown as MessageBlock[]).slice(
              0,
              EDITION_TEXT_MAX,
            )
          : "";
        return {
          routine: {
            id: routine.id,
            botId: routine.botId,
            active: routine.active,
            crons: routine.crons,
            timezone: routine.timezone,
            nextRunAt: routine.nextRunAt?.toISOString() ?? null,
          },
          edition:
            run && text
              ? {
                  runId: run.id,
                  botId: run.botId,
                  threadId: run.threadId,
                  publishedAt: (run.completedAt ?? run.updatedAt).toISOString(),
                  text,
                }
              : null,
        };
      }),
    },
  };
}
