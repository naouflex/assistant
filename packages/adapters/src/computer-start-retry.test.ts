import { SandboxRateLimitError, SandboxUnavailableError } from "@atlas/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { ComputerBusyError } from "./computer-lifecycle.js";
import { isTransientComputerStartError, startComputerWithRetry } from "./computer-start-retry.js";

describe("isTransientComputerStartError", () => {
  it.each([
    [new ComputerBusyError(), true],
    [new SandboxUnavailableError(), true],
    [new Error("command aborted\n"), true],
    [new Error("read ECONNRESET"), true],
    [Object.assign(new Error("upstream"), { code: 503 }), true],
    [Object.assign(new Error("not allowed"), { code: 403 }), false],
    [new Error("Computer requires recovery after an unconfirmed stop"), false],
    [new AggregateError([new Error("command aborted")], "rollback failed"), false],
    ["command aborted", false],
  ])("%s -> %s", (error, transient) => {
    expect(isTransientComputerStartError(error)).toBe(transient);
  });

  it("does not retry a rate limit", () => {
    expect(isTransientComputerStartError(new SandboxRateLimitError())).toBe(false);
  });
});

describe("startComputerWithRetry", () => {
  const signal = () => new AbortController().signal;

  it("retries a transient failure and returns the computer", async () => {
    const start = vi
      .fn()
      .mockRejectedValueOnce(new Error("command aborted"))
      .mockRejectedValueOnce(new ComputerBusyError())
      .mockResolvedValue("computer");
    await expect(
      startComputerWithRetry(start, { signal: signal(), delaysMs: [0, 0, 0] }),
    ).resolves.toBe("computer");
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("fails at once on a lasting failure", async () => {
    const failure = new Error("Computer requires recovery after an unconfirmed stop");
    const start = vi.fn().mockRejectedValue(failure);
    await expect(
      startComputerWithRetry(start, { signal: signal(), delaysMs: [0, 0] }),
    ).rejects.toBe(failure);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last delay with the last failure", async () => {
    const start = vi.fn().mockRejectedValue(new Error("read ECONNRESET"));
    await expect(
      startComputerWithRetry(start, { signal: signal(), delaysMs: [0, 0] }),
    ).rejects.toThrow("ECONNRESET");
    expect(start).toHaveBeenCalledTimes(3);
  });

  it("stops retrying once the run is aborted", async () => {
    const controller = new AbortController();
    const start = vi.fn().mockImplementation(async () => {
      controller.abort();
      throw new Error("command aborted");
    });
    await expect(
      startComputerWithRetry(start, { signal: controller.signal, delaysMs: [0, 0] }),
    ).rejects.toThrow("command aborted");
    expect(start).toHaveBeenCalledTimes(1);
  });
});
