import path from "node:path";
import type { AgentToolExecutionResult, ProcessEvent } from "@atlas/adapter-kit";
import { redactSecrets, sandboxCommandTimeoutMs } from "@atlas/core";
import { z } from "zod";
import type { HostComputerEnvironment } from "./host-computer-protocol.js";
import type {
  HostScreenAction,
  HostScreenActResult,
  HostScreenObservation,
} from "./host-screen.js";
import { HOST_SCREEN_MAX_ACTIONS, hostScreenAction } from "./host-screen.js";
import { nativeShellCommandArgv } from "./native-shell.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import {
  isRunningShellCommand,
  observeShellCommand,
  SHELL_STILL_RUNNING_NOTICE,
} from "./shell-command-stream.js";
import {
  USER_COMPUTER_ACT_TOOL,
  USER_COMPUTER_OBSERVE_TOOL,
  USER_COMPUTER_SCREEN_TOOLS,
  USER_COMPUTER_SHELL_TOOL,
  USER_COMPUTER_TOOLS,
  userComputerAppName,
} from "./user-computer-tools.js";

export {
  USER_COMPUTER_ACT_TOOL,
  USER_COMPUTER_OBSERVE_TOOL,
  USER_COMPUTER_SCREEN_TOOLS,
  USER_COMPUTER_SHELL_TOOL,
  USER_COMPUTER_TOOLS,
  userComputerAppName,
};

/** Whether the run's owner has their desktop connected, or paired but offline. */
export type UserComputerState = "connected" | "offline" | undefined;

const USER_COMPUTER_UNAVAILABLE =
  "The user's computer is not connected. Ask them to open the Atlas desktop app.";

/**
 * Whose own computer this run may reach: the person whose message started it, when they own the
 * bot. Routines, webhooks, channels, other bots and other people's messages reach no one's.
 */
export function userComputerOwner(input: {
  trigger: string;
  sourceRole: string | undefined;
  messagingChannelRun: boolean;
  runUserId: string;
  botUserId: string;
}): string | undefined {
  if (input.trigger !== "user" && input.trigger !== "follow_up") return undefined;
  if (input.sourceRole !== "user" || input.messagingChannelRun) return undefined;
  return input.runUserId === input.botUserId ? input.runUserId : undefined;
}

type PeerChainPrisma = {
  message: {
    findUnique(args: {
      where: { id: string };
      select: { role: true; blocks: true; runId: true };
    }): Promise<{ role: string; blocks: unknown; runId: string | null } | null>;
  };
  run: {
    findUnique(args: {
      where: { id: string };
      select: {
        trigger: true;
        sourceMessageId: true;
        userId: true;
        bot: { select: { userId: true } };
      };
    }): Promise<{
      trigger: string;
      sourceMessageId: string | null;
      userId: string;
      bot: { userId: string };
    } | null>;
  };
};

const PEER_CHAIN_MAX_HOPS = 8;

function peerReturnMessageId(blocks: unknown): string | undefined {
  if (!Array.isArray(blocks)) return undefined;
  for (const block of blocks) {
    if (
      block &&
      typeof block === "object" &&
      (block as { kind?: unknown }).kind === "bot_message_received"
    ) {
      const id = (block as { returnToMessageId?: unknown }).returnToMessageId;
      return typeof id === "string" && id ? id : undefined;
    }
  }
  return undefined;
}

/**
 * A run woken by another bot's message reaches the owner's computer when the chain of peer
 * messages behind it starts at the owner's own message to a bot they own: a task the owner handed
 * to one bot that delegated it on (Strike Dev asking Autoresearch Dev to read logs on the owner's
 * PC). Routines, webhooks, channels and other people's messages anywhere up the chain still reach
 * no one's, and userComputerGate's approval applies as for the owner's own runs.
 */
export async function peerChainUserComputerOwner(
  prisma: PeerChainPrisma,
  run: { trigger: string; sourceMessageId: string | null | undefined; userId: string },
  botUserId: string,
): Promise<string | undefined> {
  if (run.trigger !== "bot_message" || run.userId !== botUserId) return undefined;
  let inboundId = run.sourceMessageId ?? undefined;
  for (let hop = 0; hop < PEER_CHAIN_MAX_HOPS && inboundId; hop++) {
    const inbound = await prisma.message.findUnique({
      where: { id: inboundId },
      select: { role: true, blocks: true, runId: true },
    });
    const returnTo = inbound && peerReturnMessageId(inbound.blocks);
    if (!returnTo) return undefined;
    const outbound = await prisma.message.findUnique({
      where: { id: returnTo },
      select: { role: true, blocks: true, runId: true },
    });
    if (!outbound?.runId) return undefined;
    const sender = await prisma.run.findUnique({
      where: { id: outbound.runId },
      select: {
        trigger: true,
        sourceMessageId: true,
        userId: true,
        bot: { select: { userId: true } },
      },
    });
    if (!sender || sender.userId !== run.userId || sender.bot.userId !== run.userId)
      return undefined;
    if (sender.trigger === "bot_message") {
      inboundId = sender.sourceMessageId ?? undefined;
      continue;
    }
    if (sender.trigger !== "user" && sender.trigger !== "follow_up") return undefined;
    if (!sender.sourceMessageId) return undefined;
    const origin = await prisma.message.findUnique({
      where: { id: sender.sourceMessageId },
      select: { role: true, blocks: true, runId: true },
    });
    // The owner's own words: a user-role message that is not itself a relayed peer message.
    if (!origin || origin.role !== "user" || peerReturnMessageId(origin.blocks)) return undefined;
    return run.userId;
  }
  return undefined;
}

/**
 * The user's own computer always asks a person first, in every approval mode and whatever the
 * rules allow, until they choose "Allow in this space"; a block still refuses it. These tools run
 * only in the user's own runs (see userComputerOwner), so any effect of them past "intended" in
 * this space traces back to that approval. Removing every paired computer ends it, so pairing again
 * asks again. Screen control is approved per app.
 */
export async function userComputerGate(
  ctx: RunContext,
  blocked: boolean,
  name: string,
  args: Record<string, unknown>,
): Promise<"deny" | "allow" | "ask"> {
  if (blocked) return "deny";
  const { deps, run } = ctx;
  const pairedSince = await deps.userDevices?.pairedSince(run.userId);
  if (!pairedSince) return "ask";
  const where = {
    spaceId: run.spaceId,
    status: { in: ["approved", "executing", "completed", "uncertain"] },
    createdAt: { gte: pairedSince },
    run: { userId: run.userId },
  };
  if (!USER_COMPUTER_SCREEN_TOOLS.has(name)) {
    const allowed = await deps.prisma.externalEffect.findFirst({
      where: { ...where, kind: USER_COMPUTER_SHELL_TOOL },
      select: { id: true },
    });
    return allowed ? "allow" : "ask";
  }
  const app = userComputerAppName(args.app).toLowerCase();
  if (!app) return "ask";
  // Every screen action records an effect, so page through them rather than cap the search.
  let cursor: string | undefined;
  for (;;) {
    const page = await deps.prisma.externalEffect.findMany({
      where: { ...where, kind: { in: [...USER_COMPUTER_SCREEN_TOOLS] } },
      select: { id: true, request: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: SCREEN_APPROVAL_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (
      page.some(
        (effect) =>
          userComputerAppName((effect.request as { app?: unknown } | null)?.app).toLowerCase() ===
          app,
      )
    )
      return "allow";
    if (page.length < SCREEN_APPROVAL_PAGE) return "ask";
    cursor = page.at(-1)!.id;
  }
}

const SCREEN_APPROVAL_PAGE = 200;

/** The working directory on the user's computer: their home or a folder inside it. */
export function userComputerCwd(environment: HostComputerEnvironment, cwd: unknown): string {
  const paths = environment.platform === "win32" ? path.win32 : path.posix;
  const requested = typeof cwd === "string" ? cwd.trim() : "";
  if (!requested || requested === "~") return environment.home;
  const expanded = /^~[\\/]/.test(requested)
    ? paths.join(environment.home, requested.slice(2))
    : requested;
  const resolved = paths.resolve(environment.home, expanded);
  const relative = paths.relative(environment.home, resolved);
  if (relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative))
    throw new Error("cwd must be inside the user's home folder; cd elsewhere within the command");
  return resolved;
}

async function lastValue<T>(values: AsyncIterable<T>): Promise<T> {
  let result: { value: T } | undefined;
  for await (const value of values) result = { value };
  if (!result) throw new Error("no response");
  return result.value;
}

/** Checked again at execution: the desktop can disconnect or be revoked after the offer. */
async function connectedUserComputer(ctx: RunContext) {
  const owner = ctx.source.userComputerOwner;
  const devices = ctx.deps.userDevices;
  const pinned = ctx.bot.userDeviceId ?? undefined;
  const device =
    owner && devices ? await devices.connected(owner, "computer", pinned).catch(() => null) : null;
  return owner && devices && device ? { owner, devices, deviceId: device.deviceId } : undefined;
}

export async function userComputerShell(ctx: RunContext, call: ToolCall) {
  const { bot, runId } = ctx;
  const connected = await connectedUserComputer(ctx);
  if (!connected) return call.finish({ error: USER_COMPUTER_UNAVAILABLE });
  const { owner, devices, deviceId } = connected;
  const { signal } = ctx.context;
  const command = String(call.args.command ?? "");
  try {
    // The device only executes for a provisioned bot; provisioning is idempotent.
    await lastValue(
      devices.request(owner, { method: "provision", botId: bot.id, runId }, signal, deviceId),
    );
    const environment = await lastValue(
      devices.request<HostComputerEnvironment>(
        owner,
        { method: "environment", botId: bot.id, runId },
        signal,
        deviceId,
      ),
    );
    const observed = await observeShellCommand(
      devices.request<ProcessEvent>(
        owner,
        {
          method: "execute",
          botId: bot.id,
          runId,
          command: {
            argv: nativeShellCommandArgv(command, environment),
            cwd: userComputerCwd(environment, call.args.cwd),
            timeoutMs: sandboxCommandTimeoutMs(),
          },
        },
        signal,
        deviceId,
      ),
      { secrets: ctx.secrets },
    );
    if (!observed.completion) return call.finish(observed.result);
    void observed.completion.catch(() => undefined);
    const returned = await call.finish({ ...observed.result, notice: SHELL_STILL_RUNNING_NOTICE });
    if (isRunningShellCommand(returned)) call.observer?.onShellStillRunning?.(observed.completion);
    return returned;
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = redactSecrets(
      error instanceof Error ? error.message : "command failed",
      ctx.secrets,
    );
    return call.finish({ error: `The user's computer did not finish the command: ${reason}` });
  }
}

const screenActions = z.array(hostScreenAction).min(1).max(HOST_SCREEN_MAX_ACTIONS);

export function userComputerObserve(ctx: RunContext, call: ToolCall) {
  const query = typeof call.args.query === "string" ? call.args.query.trim() : "";
  return userComputerScreen(ctx, call, {
    method: "screenObserve",
    app: userComputerAppName(call.args.app),
    ...(query ? { query } : {}),
  });
}

export function userComputerAct(ctx: RunContext, call: ToolCall) {
  const actions = screenActions.safeParse(call.args.actions);
  if (!actions.success) {
    const issue = actions.error.issues[0];
    const where = issue?.path.length ? `actions.${issue.path.join(".")}: ` : "actions: ";
    return call.finish({ error: `${where}${issue?.message ?? "invalid"}` });
  }
  return userComputerScreen(ctx, call, {
    method: "screenAct",
    app: userComputerAppName(call.args.app),
    actions: actions.data,
  });
}

type ScreenRequest =
  | { method: "screenObserve"; app: string; query?: string }
  | { method: "screenAct"; app: string; actions: HostScreenAction[] };

/** The device gets the app name the approval card showed, never the raw argument. */
async function userComputerScreen(ctx: RunContext, call: ToolCall, request: ScreenRequest) {
  if (!request.app) return call.finish({ error: "app must name an app on the user's computer." });
  const connected = await connectedUserComputer(ctx);
  if (!connected) return call.finish({ error: USER_COMPUTER_UNAVAILABLE });
  const { owner, devices, deviceId } = connected;
  const { signal } = ctx.context;
  try {
    const value = await lastValue(
      devices.request<HostScreenObservation | HostScreenActResult>(
        owner,
        { ...request, botId: ctx.bot.id, runId: ctx.runId },
        signal,
        deviceId,
      ),
    );
    if (request.method === "screenObserve")
      return call.finish(screenToolResult(ctx, value as HostScreenObservation, "observed"));
    const acted = value as HostScreenActResult;
    const total = request.actions.length;
    const note = `completed ${acted.completed} of ${total} action${total === 1 ? "" : "s"}${
      acted.error ? `; stopped: ${redactSecrets(acted.error, ctx.secrets)}` : ""
    }`;
    return call.finish(
      acted.observation
        ? screenToolResult(ctx, acted.observation, note)
        : { completed: acted.completed, ...(acted.error ? { error: note } : {}) },
    );
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = redactSecrets(
      error instanceof Error ? error.message : "screen control failed",
      ctx.secrets,
    );
    return call.finish({ error: `The user's computer did not finish: ${reason}` });
  }
}

/** Only the window's name and size are stored; the rows and screenshot reach the model alone. */
function screenToolResult(
  ctx: RunContext,
  observation: HostScreenObservation,
  note: string,
): AgentToolExecutionResult {
  const image = ctx.computer.acceptsImages ? observation.image : undefined;
  const details = {
    app: observation.app,
    ...(observation.title ? { title: redactSecrets(observation.title, ctx.secrets) } : {}),
    ...(image ? { width: image.width, height: image.height } : {}),
  };
  return {
    kind: "agent_tool_result",
    content: [
      {
        type: "text",
        text: `${note}\n${JSON.stringify(details)}\n${redactSecrets(observation.tree, ctx.secrets)}`,
      },
      ...(image ? [{ type: "image" as const, data: image.data, mimeType: image.mimeType }] : []),
    ],
    details,
  };
}
