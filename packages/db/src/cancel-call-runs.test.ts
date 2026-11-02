import { describe, expect, it, vi } from "vitest";
import { cancelActiveCallTurnRuns } from "./cancel-call-runs.js";

describe("cancelActiveCallTurnRuns", () => {
  it("cancels active voice turns for the call id but not call_end wrap-ups", async () => {
    const updateManyAndReturn = vi.fn().mockResolvedValue([{ id: "run-turn" }]);
    const tx = {
      run: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "run-turn",
            taskId: "task-1",
            userId: "user-1",
            spaceId: "space-1",
            botId: "bot-1",
          },
        ]),
        updateManyAndReturn,
      },
      attempt: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      task: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      externalEffect: { deleteMany: vi.fn() },
      secret: { deleteMany: vi.fn() },
      message: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    };
    const cancelled = await cancelActiveCallTurnRuns(tx as never, {
      threadId: "thread-1",
      botId: "bot-1",
      callId: "call-1",
    });
    expect(tx.run.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientNonce: { startsWith: "call:call-1:" },
          trigger: { not: "call_end" },
        }),
      }),
    );
    expect(cancelled.map((run) => run.id)).toEqual(["run-turn"]);
  });
});
