import { beforeEach, describe, expect, it, vi } from "vitest";
import { messagingTools } from "./run-tools-messaging.js";
import { publishMessage } from "./run-messages.js";

vi.mock("./run-messages.js", () => ({
  publishMessage: vi.fn(async () => ({ id: "reaction-1" })),
}));
vi.mock("./run-progress.js", () => ({
  flushProgress: vi.fn(async () => undefined),
  nextProgressNonce: () => "progress:react:1",
  canPublishDurableProgress: () => true,
  publishMidTurnNarration: vi.fn(),
  showNarrationStatus: vi.fn(),
}));

function call(args: Record<string, unknown>) {
  const finish = vi.fn((result: unknown) => result);
  return {
    args,
    finish,
    effectKey: "effect",
  };
}

describe("react_to_message", () => {
  const publish = vi.mocked(publishMessage);
  const findFirst = vi.fn();
  const react = messagingTools.react_to_message!;

  beforeEach(() => {
    publish.mockClear();
    findFirst.mockReset();
  });

  it("reacts to the source message by default", async () => {
    findFirst.mockResolvedValue({ id: "user-1" });
    const ctx = {
      deps: { prisma: { message: { findFirst } } },
      run: { id: "run-1", threadId: "thread-1", sourceMessageId: "user-1" },
      state: { reply: {} },
    };
    const result = await react(ctx as never, call({ emoji: "👍" }) as never);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "user-1", threadId: "thread-1" },
      select: { id: true },
    });
    expect(publish).toHaveBeenCalledWith(
      ctx.deps,
      ctx.run,
      "bot",
      [{ kind: "text", text: "👍" }],
      false,
      "progress:react:1",
      undefined,
      "user-1",
    );
    expect(result).toEqual({ ok: true, emoji: "👍", messageId: "user-1" });
  });

  it("rejects unknown emoji and missing targets", async () => {
    const ctx = {
      deps: { prisma: { message: { findFirst } } },
      run: { id: "run-1", threadId: "thread-1", sourceMessageId: null },
      state: { reply: {} },
    };
    await expect(react(ctx as never, call({ emoji: "🚀" }) as never)).resolves.toEqual({
      error: "emoji must be one of the six reaction emoji",
    });
    await expect(react(ctx as never, call({ emoji: "🎉" }) as never)).resolves.toEqual({
      error: "No message to react to on this turn",
    });
  });
});
