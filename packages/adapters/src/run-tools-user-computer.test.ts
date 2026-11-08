import { describe, expect, it, vi } from "vitest";
import type { HostComputerRequest } from "./host-computer-protocol.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import {
  peerChainUserComputerOwner,
  userComputerCwd,
  userComputerGate,
  userComputerOwner,
  userComputerShell,
} from "./run-tools-user-computer.js";
import type { UserDeviceGateway } from "./user-device-protocol.js";

const environment = { platform: "darwin", home: "/Users/fake", shell: "/bin/zsh" };

function setup(execute: (signal: AbortSignal) => AsyncIterable<unknown>, secrets: string[] = []) {
  const controller = new AbortController();
  const requests: HostComputerRequest[] = [];
  const signals: AbortSignal[] = [];
  const deviceIds: (string | undefined)[] = [];
  const gateway: UserDeviceGateway = {
    connected: async () => ({ deviceId: "device-1", name: "Laptop", platform: "darwin" }),
    pairedSince: async () => new Date(0),
    async *request<T>(
      _userId: string,
      request: HostComputerRequest,
      signal: AbortSignal,
      deviceId?: string,
    ) {
      requests.push(request);
      deviceIds.push(deviceId);
      signals.push(signal);
      if (request.method === "provision") yield {} as T;
      else if (request.method === "environment") yield environment as T;
      else yield* execute(signal) as AsyncIterable<T>;
    },
  };
  const ctx = {
    deps: { userDevices: gateway },
    bot: { id: "bot-1" },
    runId: "run-1",
    source: { userComputerOwner: "user-1" },
    context: { signal: controller.signal },
    secrets,
  } as unknown as RunContext;
  const onShellStillRunning = vi.fn();
  const call = (args: Record<string, unknown>) =>
    ({
      name: "user_computer_shell",
      args,
      observer: { onShellStillRunning },
      finish: async (result: unknown) => result,
    }) as unknown as ToolCall;
  return { ctx, call, controller, requests, signals, deviceIds, onShellStillRunning };
}

describe("userComputerGate", () => {
  it("finds an app approved before hundreds of later screen actions", async () => {
    const effects = [
      ...Array.from({ length: 450 }, (_, index) => ({ id: `e${450 - index}`, app: "TextEdit" })),
      { id: "e0", app: "Mail" },
    ].map(({ id, app }) => ({ id, request: { app } }));
    const findMany = vi.fn(async ({ take, cursor }: { take: number; cursor?: { id: string } }) => {
      const start = cursor ? effects.findIndex((effect) => effect.id === cursor.id) + 1 : 0;
      return effects.slice(start, start + take);
    });
    const ctx = {
      deps: {
        userDevices: { pairedSince: async () => new Date(0) },
        prisma: { externalEffect: { findMany } },
      },
      run: { spaceId: "space-1", userId: "user-1" },
    } as unknown as RunContext;
    await expect(
      userComputerGate(ctx, false, "user_computer_observe", { app: "mail" }),
    ).resolves.toBe("allow");
    expect(findMany).toHaveBeenCalledTimes(3);
    await expect(
      userComputerGate(ctx, false, "user_computer_observe", { app: "Notes" }),
    ).resolves.toBe("ask");
  });
});

describe("userComputerOwner", () => {
  const own = {
    trigger: "user",
    sourceRole: "user",
    messagingChannelRun: false,
    runUserId: "user-1",
    botUserId: "user-1",
  };

  it("is the bot owner when their own message started the run", () => {
    expect(userComputerOwner(own)).toBe("user-1");
    expect(userComputerOwner({ ...own, trigger: "follow_up" })).toBe("user-1");
  });

  it.each([
    { trigger: "routine" },
    { trigger: "webhook" },
    { trigger: "messaging" },
    { trigger: "call_end" },
    { sourceRole: "bot" },
    { sourceRole: undefined },
    { messagingChannelRun: true },
    { runUserId: "user-2" },
  ])("is nobody for %o", (change) => {
    expect(userComputerOwner({ ...own, ...change })).toBeUndefined();
  });
});

describe("userComputerCwd", () => {
  it("defaults to home and resolves relative and ~ paths against it", () => {
    expect(userComputerCwd(environment, undefined)).toBe("/Users/fake");
    expect(userComputerCwd(environment, "~")).toBe("/Users/fake");
    expect(userComputerCwd(environment, "~/code")).toBe("/Users/fake/code");
    expect(userComputerCwd(environment, "code")).toBe("/Users/fake/code");
    expect(userComputerCwd(environment, "/Users/fake/code")).toBe("/Users/fake/code");
    expect(userComputerCwd(environment, "..cache")).toBe("/Users/fake/..cache");
    expect(() => userComputerCwd(environment, "/tmp")).toThrow("inside the user's home folder");
    expect(() => userComputerCwd(environment, "../other")).toThrow("inside the user's home folder");
    expect(
      userComputerCwd({ platform: "win32", home: "C:\\Users\\fake", shell: "pwsh" }, "code"),
    ).toBe("C:\\Users\\fake\\code");
  });
});

describe("userComputerShell", () => {
  it("streams the command's redacted output from the user's shell", async () => {
    const { ctx, call, requests, deviceIds } = setup(
      async function* () {
        yield { type: "stdout", data: "token=sk-fake-secret\n" };
        yield { type: "stderr", data: "warning\n" };
        yield { type: "exit", code: 2 };
      },
      ["sk-fake-secret"],
    );
    const result = (await userComputerShell(ctx, call({ command: "cat .env", cwd: "app" }))) as {
      stdout: string;
      stderr: string;
      code: number;
    };
    expect(result.stdout).not.toContain("sk-fake-secret");
    expect(result).toMatchObject({ stderr: "warning\n", code: 2 });
    expect(deviceIds).toEqual(["device-1", "device-1", "device-1"]);
    expect(requests).toEqual([
      { method: "provision", botId: "bot-1", runId: "run-1" },
      { method: "environment", botId: "bot-1", runId: "run-1" },
      {
        method: "execute",
        botId: "bot-1",
        runId: "run-1",
        command: expect.objectContaining({
          argv: ["/bin/zsh", "-lc", "cat .env"],
          cwd: "/Users/fake/app",
        }),
      },
    ]);
  });

  it("returns a quiet long-running command early and keeps collecting its output", async () => {
    let finish!: () => void;
    const exited = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.useFakeTimers();
    try {
      const { ctx, call, onShellStillRunning } = setup(async function* () {
        yield { type: "stdout", data: "Enter code ABCD\n" };
        await exited;
        yield { type: "exit", code: 0 };
      });
      const pending = userComputerShell(ctx, call({ command: "gh auth login" }));
      await vi.advanceTimersByTimeAsync(1_500);
      expect(await pending).toMatchObject({ stdout: "Enter code ABCD\n", running: true });
      expect(onShellStillRunning).toHaveBeenCalledOnce();
      finish();
      await expect(onShellStillRunning.mock.calls[0]![0]).resolves.toMatchObject({ code: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a device that drops mid-command as an error result", async () => {
    const { ctx, call } = setup(async function* () {
      yield* [];
      throw new Error("Device disconnected");
    });
    expect(await userComputerShell(ctx, call({ command: "ls" }))).toEqual({
      error: "The user's computer did not finish the command: Device disconnected",
    });
  });

  it("passes the run's abort to the device and rethrows it", async () => {
    const { ctx, call, controller, signals } = setup(async function* (signal) {
      yield* [];
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      throw new Error("aborted");
    });
    const pending = userComputerShell(ctx, call({ command: "sleep 100" }));
    await vi.waitFor(() => expect(signals).toHaveLength(3));
    controller.abort();
    await expect(pending).rejects.toThrow("aborted");
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

describe("peerChainUserComputerOwner", () => {
  type Msg = { role: string; blocks: unknown; runId: string | null };
  type Run = {
    trigger: string;
    sourceMessageId: string | null;
    userId: string;
    bot: { userId: string };
  };
  function fake(messages: Record<string, Msg>, runs: Record<string, Run>) {
    return {
      message: {
        findUnique: async ({ where }: { where: { id: string } }) => messages[where.id] ?? null,
      },
      run: { findUnique: async ({ where }: { where: { id: string } }) => runs[where.id] ?? null },
    } as unknown as Parameters<typeof peerChainUserComputerOwner>[0];
  }
  const received = (returnTo: string) => [
    {
      kind: "bot_message_received",
      fromBotId: "a",
      fromBotName: "A",
      text: "x",
      returnToMessageId: returnTo,
    },
  ];
  const messages: Record<string, Msg> = {
    own: { role: "user", blocks: [{ kind: "text", text: "check the logs" }], runId: "run-a" },
    outAB: { role: "bot", blocks: [], runId: "run-a" },
    inB: { role: "user", blocks: received("outAB"), runId: "run-b" },
    outBC: { role: "bot", blocks: [], runId: "run-b" },
    inC: { role: "user", blocks: received("outBC"), runId: "run-c" },
  };
  const runs: Record<string, Run> = {
    "run-a": {
      trigger: "user",
      sourceMessageId: "own",
      userId: "user-1",
      bot: { userId: "user-1" },
    },
    "run-b": {
      trigger: "bot_message",
      sourceMessageId: "inB",
      userId: "user-1",
      bot: { userId: "user-1" },
    },
  };
  const woken = { trigger: "bot_message", sourceMessageId: "inB", userId: "user-1" };

  it("reaches the owner when their own message started the chain, across hops", async () => {
    await expect(peerChainUserComputerOwner(fake(messages, runs), woken, "user-1")).resolves.toBe(
      "user-1",
    );
    await expect(
      peerChainUserComputerOwner(
        fake(messages, runs),
        { ...woken, sourceMessageId: "inC" },
        "user-1",
      ),
    ).resolves.toBe("user-1");
  });

  it.each([
    ["a routine started the chain", { "run-a": { ...runs["run-a"]!, trigger: "routine" } }, {}],
    ["a webhook started the chain", { "run-a": { ...runs["run-a"]!, trigger: "webhook" } }, {}],
    ["another person's run", { "run-a": { ...runs["run-a"]!, userId: "user-2" } }, {}],
    ["another person's bot", { "run-a": { ...runs["run-a"]!, bot: { userId: "user-2" } } }, {}],
    [
      "the origin was itself a relayed peer message",
      {},
      { own: { ...messages.own!, blocks: received("x") } },
    ],
    ["the origin was a bot message", {}, { own: { ...messages.own!, role: "bot" } }],
  ])("is nobody when %s", async (_label, runChange, messageChange) => {
    const db = fake({ ...messages, ...messageChange }, { ...runs, ...runChange } as Record<
      string,
      Run
    >);
    await expect(peerChainUserComputerOwner(db, woken, "user-1")).resolves.toBeUndefined();
  });

  it("is nobody for other triggers or a bot owned by someone else", async () => {
    const db = fake(messages, runs);
    await expect(
      peerChainUserComputerOwner(db, { ...woken, trigger: "routine" }, "user-1"),
    ).resolves.toBeUndefined();
    await expect(peerChainUserComputerOwner(db, woken, "user-2")).resolves.toBeUndefined();
  });

  it("stops on a cycle", async () => {
    const loop: Record<string, Run> = {
      ...runs,
      "run-a": {
        trigger: "bot_message",
        sourceMessageId: "inB",
        userId: "user-1",
        bot: { userId: "user-1" },
      },
    };
    await expect(
      peerChainUserComputerOwner(fake(messages, loop), woken, "user-1"),
    ).resolves.toBeUndefined();
  });
});
