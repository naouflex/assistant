import { describe, expect, it, vi } from "vitest";
import { ComputerBusyError } from "./computer-lifecycle.js";

const queue = vi.hoisted(() => vi.fn());
vi.mock("./computer-update.js", () => ({ queueComputerUpdate: queue }));
vi.mock("@atlas/db", () => ({ asSystem: (prisma: unknown) => prisma }));

const { COMPUTER_RECOVERY_MAX_ATTEMPTS, sweepComputerHealth } = await import(
  "./computer-health.js"
);

const minutes = (n: number) => n * 60_000;
const now = new Date("2026-11-02T12:00:00Z");

function setup(computer: Record<string, unknown>) {
  const row = {
    id: "c1",
    spaceId: "s1",
    userId: "u1",
    healthRecoveryAttempts: 0,
    healthRecoveryAt: null,
    bots: [{ id: "b1", name: "Ada" }],
    ...computer,
  };
  const updates: unknown[] = [];
  const events: Array<{ attempt: number; outcome: string }> = [];
  const prisma = {
    computer: {
      findMany: vi.fn(async () => [row]),
      updateMany: vi.fn(async (args: { where: { id?: string } }) => {
        updates.push(args);
        return { count: args.where.id ? 1 : 0 };
      }),
    },
    computerHealthEvent: {
      create: vi.fn(async ({ data }: { data: { attempt: number; outcome: string } }) => {
        events.push({ attempt: data.attempt, outcome: data.outcome });
      }),
    },
    thread: { findFirst: vi.fn(async () => ({ id: "t1" })) },
  };
  const notifications = { send: vi.fn(async () => {}) };
  const deps = {
    prisma: prisma as never,
    jobs: {} as never,
    notifications: notifications as never,
  };
  return { deps, updates, events, notifications };
}

describe("computer health sweep", () => {
  it("queues the first recovery for a computer in error", async () => {
    queue.mockReset().mockResolvedValue(undefined);
    const { deps, events, updates } = setup({});
    await sweepComputerHealth(deps, now);
    expect(queue).toHaveBeenCalledWith(deps, "c1", "b1", "recover");
    expect(events).toEqual([{ attempt: 1, outcome: "queued" }]);
    expect(updates).toContainEqual({
      where: { id: "c1", healthRecoveryAttempts: 0, state: "error" },
      data: { healthRecoveryAttempts: 1, healthRecoveryAt: now },
    });
  });

  it("waits out the backoff before the next try", async () => {
    queue.mockReset().mockResolvedValue(undefined);
    const early = setup({
      healthRecoveryAttempts: 1,
      healthRecoveryAt: new Date(now.getTime() - minutes(10)),
    });
    await sweepComputerHealth(early.deps, now);
    expect(queue).not.toHaveBeenCalled();
    const due = setup({
      healthRecoveryAttempts: 1,
      healthRecoveryAt: new Date(now.getTime() - minutes(16)),
    });
    await sweepComputerHealth(due.deps, now);
    expect(due.events).toEqual([{ attempt: 2, outcome: "queued" }]);
  });

  it("does not spend a try while the user holds the computer", async () => {
    queue.mockReset().mockRejectedValue(new ComputerBusyError());
    const { deps, events, updates } = setup({});
    await sweepComputerHealth(deps, now);
    expect(events).toEqual([{ attempt: 1, outcome: "busy" }]);
    expect(updates).toContainEqual({
      where: { id: "c1", healthRecoveryAttempts: 1 },
      data: { healthRecoveryAttempts: 0 },
    });
  });

  it("records a failed queue and keeps the try", async () => {
    queue.mockReset().mockRejectedValue(new Error("provider down"));
    const { deps, events } = setup({});
    await sweepComputerHealth(deps, now);
    expect(events).toEqual([{ attempt: 1, outcome: "failed" }]);
  });

  it("tells the owner once after the last try and stops recovering", async () => {
    queue.mockReset();
    const { deps, events, notifications } = setup({
      healthRecoveryAttempts: COMPUTER_RECOVERY_MAX_ATTEMPTS,
      healthRecoveryAt: new Date(now.getTime() - minutes(46)),
    });
    await sweepComputerHealth(deps, now);
    expect(queue).not.toHaveBeenCalled();
    expect(events).toEqual([{ attempt: 3, outcome: "alerted" }]);
    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "computer", botId: "b1", threadId: "t1" }),
      expect.objectContaining({ userId: "u1", spaceId: "s1" }),
    );
  });

  it("skips a computer with no bot", async () => {
    queue.mockReset();
    const { deps, events } = setup({ bots: [] });
    await sweepComputerHealth(deps, now);
    expect(queue).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
