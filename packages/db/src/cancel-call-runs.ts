import { ACTIVE_RUN_STATUSES, CALL_CLIENT_NONCE_PREFIX } from "@atlas/core";
import type { Prisma } from "./client.js";
import { cancelRunsInTransaction } from "./cancel-runs.js";

/** In-flight voice turns for one call id; the hang-up wrap-up run is left alone. */
export async function cancelActiveCallTurnRuns(
  tx: Pick<
    Prisma.TransactionClient,
    "run" | "attempt" | "task" | "externalEffect" | "secret" | "message"
  >,
  input: { threadId: string; botId: string; callId: string },
  cancelledAt = new Date(),
) {
  const prefix = `${CALL_CLIENT_NONCE_PREFIX}${input.callId}:`;
  const runs = await tx.run.findMany({
    where: {
      threadId: input.threadId,
      botId: input.botId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
      clientNonce: { startsWith: prefix },
      trigger: { not: "call_end" },
    },
    select: { id: true, taskId: true, userId: true, spaceId: true, botId: true },
  });
  return cancelRunsInTransaction(tx, runs, cancelledAt);
}
