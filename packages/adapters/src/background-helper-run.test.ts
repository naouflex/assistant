import { describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_WAKE_DELAY_MS,
  cancelQueuedBackgroundHelpers,
  helperMayStartAnother,
  helperParentStillRunning,
  queueBackgroundHelper,
} from "./background-helper-run.js";

const parent = {
  id: "run-1",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  threadId: "thread-1",
  sourceMessageId: null,
  status: "running",
  trigger: "user",
};

describe("background helpers", () => {
  it("wakes a stuck helper in minutes, not a day", () => {
    expect(BACKGROUND_WAKE_DELAY_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it("refuses a helper that would start another helper", async () => {
    expect(helperMayStartAnother("follow_up")).toBe(false);
    const create = vi.fn();
    const result = await queueBackgroundHelper(
      { prisma: { run: { findFirst: vi.fn(), create } }, jobs: { enqueue: vi.fn() } } as never,
      { parentRun: { ...parent, trigger: "follow_up" }, name: "nested", task: "again", executionId: "1" },
    );
    expect(result).toEqual({ error: "A follow-up run cannot start a background helper." });
    expect(create).not.toHaveBeenCalled();
  });

  it("does not start while the parent turn is still active", async () => {
    const findUnique = vi.fn(async () => ({ status: "running" }));
    await expect(
      helperParentStillRunning(
        { prisma: { run: { findUnique } } as never },
        "background:run-1:call",
      ),
    ).resolves.toBe(true);
    findUnique.mockResolvedValueOnce({ status: "completed" });
    await expect(
      helperParentStillRunning(
        { prisma: { run: { findUnique } } as never },
        "background:run-1:call",
      ),
    ).resolves.toBe(false);
  });

  it("cancels queued helpers when the parent fails", async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    const findMany = vi.fn(async () => [{ id: "helper-1" }, { id: "helper-2" }]);
    await cancelQueuedBackgroundHelpers(
      { prisma: { run: { findMany, updateMany } } as never },
      "run-1",
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["helper-1", "helper-2"] }, status: "queued" },
      data: { status: "cancelled", wakeAt: null },
    });
  });
});
