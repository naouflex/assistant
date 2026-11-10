import type { ComputerRef } from "@atlas/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPUTER_PREWARM_RECENT_MS,
  lazyRunComputer,
  noteComputerUsed,
  resetComputerUseHints,
  shouldPrewarmComputer,
} from "./run-computer.js";

const computer = { id: "pod-1", botId: "bot-1", kind: "kubernetes" } as ComputerRef;

describe("lazyRunComputer", () => {
  it("starts once on first use", async () => {
    const start = vi.fn().mockResolvedValue(computer);
    const lazy = lazyRunComputer(start);
    expect(lazy.ready).toBeUndefined();
    await expect(Promise.all([lazy.get(), lazy.get()])).resolves.toEqual([computer, computer]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(lazy.ready).toBe(computer);
  });

  it("reuses a prewarmed start for the first tool", async () => {
    const start = vi.fn().mockResolvedValue(computer);
    const lazy = lazyRunComputer(start);
    lazy.prewarm();
    lazy.prewarm();
    await expect(lazy.get()).resolves.toBe(computer);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not fail the run when an early start fails, and starts again on use", async () => {
    const onFailure = vi.fn();
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error("command aborted"))
      .mockResolvedValue(computer);
    const lazy = lazyRunComputer(start, onFailure);
    lazy.prewarm();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(() => lazy.throwIfFailed()).not.toThrow();
    await expect(lazy.get()).resolves.toBe(computer);
    expect(start).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("keeps a failure on real use", async () => {
    const onFailure = vi.fn();
    const lazy = lazyRunComputer(vi.fn().mockRejectedValue(new Error("boom")), onFailure);
    await expect(lazy.get()).rejects.toThrow("boom");
    expect(() => lazy.throwIfFailed()).toThrow("boom");
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});

describe("shouldPrewarmComputer", () => {
  const base = {
    computerId: "computer-1",
    kind: "kubernetes",
    state: "stopped",
    trigger: "user",
    heldForTakeover: false,
  };
  beforeEach(() => resetComputerUseHints());

  it("waits for a tool when the computer was not used recently", () => {
    expect(shouldPrewarmComputer(base)).toBe(false);
    noteComputerUsed("computer-1", 0);
    expect(shouldPrewarmComputer(base, COMPUTER_PREWARM_RECENT_MS + 1)).toBe(false);
  });

  it("starts early for an owner's turn after recent use", () => {
    noteComputerUsed("computer-1", 1_000);
    expect(shouldPrewarmComputer(base, 2_000)).toBe(true);
  });

  it.each([
    { trigger: "routine" },
    { heldForTakeover: true },
    { kind: "desktop" },
    { state: "quarantined" },
  ])("never starts early for %o", (override) => {
    noteComputerUsed("computer-1", 1_000);
    expect(shouldPrewarmComputer({ ...base, ...override }, 2_000)).toBe(false);
  });
});
