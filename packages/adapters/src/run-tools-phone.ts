import type { AgentToolExecutionResult } from "@atlas/adapter-kit";
import { redactSecrets, sandboxCommandTimeoutMs } from "@atlas/core";
import { recordSecurityEvent } from "@atlas/db";
import { getLogger } from "@atlas/logging";
import { MODEL_CANNOT_SEE_MESSAGE } from "./model-vision.js";
import type {
  PhoneAction,
  PhoneNotificationResult,
  PhoneScreen,
  PhoneShellResult,
} from "./phone-protocol.js";
import {
  PHONE_CONTROL_TOOLS,
  PHONE_KEY_TOOL,
  PHONE_NOTIFICATION_KEY_MAX,
  PHONE_NOTIFICATION_TOOL,
  PHONE_NOTIFICATION_VERBS,
  PHONE_OPEN_APP_TOOL,
  PHONE_SCREENSHOT_TOOL,
  PHONE_SHELL_MAX_COMMAND,
  PHONE_SHELL_TOOL,
  PHONE_SWIPE_TOOL,
  PHONE_TAP_TOOL,
  PHONE_TYPE_TOOL,
  PHONE_UI_TREE_TOOL,
  phoneAction,
} from "./phone-protocol.js";
import type { RunContext } from "./run-context.js";
import { publishMessage } from "./run-messages.js";
import type { ToolCall, ToolHandler } from "./run-tool-gate.js";

export const ENABLE_PHONE_CONTROL_ACTION = "enable_phone_control";

export const PHONE_UNAVAILABLE =
  "The user's phone is not connected. A card in the chat asks them to turn phone control on. Wait until they allow it, then try the phone tool again. Do not send them to Settings.";

/**
 * Like the user's computer, the phone asks a person first until they allow it in this space:
 * once for screen control and once for its shell. Removing the phone ends it, so pairing again
 * asks again; a block still refuses it. These tools run only in the owner's own runs.
 */
export async function phoneGate(
  ctx: RunContext,
  blocked: boolean,
  name: string,
  args: Record<string, unknown> = {},
): Promise<"deny" | "allow" | "ask"> {
  if (blocked) return "deny";
  const { deps, run } = ctx;
  const pairedSince = await deps.userDevices?.pairedSince(run.userId, "phone");
  if (!pairedSince) return "ask";
  const where = {
    spaceId: run.spaceId,
    status: { in: ["approved", "executing", "completed", "uncertain"] },
    createdAt: { gte: pairedSince },
    run: { userId: run.userId },
  };
  // A normal shell approval does not cover privileged commands. Privileged does cover a normal one.
  if (name === PHONE_SHELL_TOOL && args.privileged === true) {
    const shells = await deps.prisma.externalEffect.findMany({
      where: { ...where, kind: PHONE_SHELL_TOOL },
      select: { request: true },
    });
    const allowed = shells.some(
      (effect) => (effect.request as { privileged?: unknown } | null)?.privileged === true,
    );
    return allowed ? "allow" : "ask";
  }
  const kind =
    name === PHONE_SHELL_TOOL
      ? [PHONE_SHELL_TOOL]
      : name === PHONE_NOTIFICATION_TOOL
        ? [PHONE_NOTIFICATION_TOOL]
        : [...PHONE_CONTROL_TOOLS];
  const allowed = await deps.prisma.externalEffect.findFirst({
    where: { ...where, kind: { in: kind } },
    select: { id: true },
  });
  return allowed ? "allow" : "ask";
}

/** The model's arguments as the phone takes them; an error names what is wrong. */
export function phoneActionFor(
  name: string,
  args: Record<string, unknown>,
): { action: PhoneAction } | { error: string } {
  const int = (value: unknown) => (typeof value === "number" ? Math.round(value) : undefined);
  const raw = (() => {
    switch (name) {
      case PHONE_SCREENSHOT_TOOL:
        return { op: "screenshot" };
      case PHONE_UI_TREE_TOOL: {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        return { op: "uiTree", ...(query ? { query } : {}) };
      }
      case PHONE_TAP_TOOL: {
        const element = int(args.element);
        const x = int(args.x);
        const y = int(args.y);
        if (element === undefined && (x === undefined || y === undefined))
          return "phone_tap needs element, or both x and y.";
        return {
          op: "tap",
          ...(element === undefined ? { x, y } : { element }),
          ...(args.long === true ? { long: true } : {}),
        };
      }
      case PHONE_SWIPE_TOOL: {
        const points = [args.x1, args.y1, args.x2, args.y2].map(int);
        const direction = typeof args.direction === "string" ? args.direction : undefined;
        if (!direction && points.some((value) => value === undefined))
          return "phone_swipe needs direction, or x1, y1, x2 and y2.";
        const [x1, y1, x2, y2] = points;
        const durationMs = int(args.duration_ms);
        return {
          op: "swipe",
          ...(direction ? { direction } : { x1, y1, x2, y2 }),
          ...(durationMs === undefined ? {} : { durationMs }),
        };
      }
      case PHONE_TYPE_TOOL: {
        const element = int(args.element);
        return {
          op: "type",
          text: typeof args.text === "string" ? args.text : "",
          ...(element === undefined ? {} : { element }),
          ...(args.submit === true ? { submit: true } : {}),
        };
      }
      case PHONE_KEY_TOOL:
        return { op: "key", key: args.key };
      case PHONE_OPEN_APP_TOOL:
        return { op: "openApp", app: typeof args.app === "string" ? args.app : "" };
      case PHONE_SHELL_TOOL: {
        if (args.termux === true && args.privileged === true)
          return "phone_shell takes termux or privileged, not both.";
        return {
          op: "shell",
          command: typeof args.command === "string" ? args.command : "",
          timeoutMs: sandboxCommandTimeoutMs(),
          ...(args.termux === true ? { termux: true } : {}),
          ...(args.privileged === true ? { privileged: true } : {}),
        };
      }
      case PHONE_NOTIFICATION_TOOL: {
        const verb = args.action === undefined ? "list" : args.action;
        if (
          typeof verb !== "string" ||
          !(PHONE_NOTIFICATION_VERBS as readonly string[]).includes(verb)
        )
          return "action must be list, open, dismiss, or activate.";
        const key = typeof args.key === "string" ? args.key.trim() : "";
        const button = typeof args.button === "string" ? args.button.trim() : "";
        if (verb !== "list" && !key)
          return "phone_notifications needs key from a previous list.";
        if (key.length > PHONE_NOTIFICATION_KEY_MAX)
          return `key must be at most ${PHONE_NOTIFICATION_KEY_MAX} characters.`;
        if (verb === "activate" && !button)
          return "phone_notifications activate needs button, the action's title.";
        return {
          op: "notifications",
          verb,
          ...(key ? { key } : {}),
          ...(button ? { button } : {}),
          ...(verb === "activate" && typeof args.text === "string" ? { text: args.text } : {}),
        };
      }
      default:
        return `${name} is not a phone tool.`;
    }
  })();
  if (typeof raw === "string") return { error: raw };
  const parsed = phoneAction.safeParse(raw);
  if (parsed.success) return { action: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".");
  if (field === "command" && name === PHONE_SHELL_TOOL)
    return {
      error: `command must be 1 to ${PHONE_SHELL_MAX_COMMAND} characters.`,
    };
  return { error: `${field ? `${field}: ` : ""}${issue?.message ?? "invalid arguments"}` };
}

async function lastValue<T>(values: AsyncIterable<T>): Promise<T> {
  let result: { value: T } | undefined;
  for await (const value of values) result = { value };
  if (!result) throw new Error("no response");
  return result.value;
}

/** Checked at execution: Phone control can be turned off or time out after the offer. */
async function connectedPhone(ctx: RunContext) {
  const owner = ctx.source.userComputerOwner;
  const devices = ctx.deps.userDevices;
  const device =
    owner && devices ? await devices.connected(owner, "phone").catch(() => null) : null;
  return owner && devices && device ? { owner, devices, deviceId: device.deviceId } : undefined;
}

/** Every phone action is logged and kept as a content-free security event for the owner. */
async function auditPhoneAction(
  ctx: RunContext,
  input: { deviceId: string; tool: string; op: string; outcome: "ok" | "error"; ms: number },
) {
  getLogger().info("phone.action", {
    "user.id": ctx.run.userId,
    "space.id": ctx.run.spaceId,
    "bot.id": ctx.bot.id,
    "run.id": ctx.runId,
    "device.id": input.deviceId,
    "phone.tool": input.tool,
    "phone.op": input.op,
    "phone.outcome": input.outcome,
    "phone.duration_ms": input.ms,
  });
  await recordSecurityEvent({
    type: "device.phone_action",
    userId: ctx.run.userId,
    spaceId: ctx.run.spaceId,
    metadata: {
      kind: "phone",
      deviceId: input.deviceId,
      botId: ctx.bot.id,
      runId: ctx.runId,
      tool: input.tool,
      op: input.op,
      outcome: input.outcome,
      ms: input.ms,
    },
  }).catch(() => undefined);
}

export const phoneTool: ToolHandler = async (ctx: RunContext, call: ToolCall) => {
  const prepared = phoneActionFor(call.name, call.args);
  if ("error" in prepared) return call.finish({ error: prepared.error });
  const { action } = prepared;
  const connected = await connectedPhone(ctx);
  if (!connected) {
    await askToEnablePhoneControl(ctx);
    return call.finish({ error: PHONE_UNAVAILABLE });
  }
  const { owner, devices, deviceId } = connected;
  const { signal } = ctx.context;
  const started = Date.now();
  try {
    const value = await lastValue(
      devices.request<PhoneScreen | PhoneShellResult>(
        owner,
        { method: "phone", botId: ctx.bot.id, runId: ctx.runId, action },
        signal,
        deviceId,
      ),
    );
    await auditPhoneAction(ctx, {
      deviceId,
      tool: call.name,
      op: action.op,
      outcome: "ok",
      ms: Date.now() - started,
    });
    if (action.op === "shell") return call.finish(phoneShellResult(ctx, value as PhoneShellResult));
    if (action.op === "notifications")
      return call.finish(phoneNotificationResult(ctx, value as PhoneNotificationResult));
    return call.finish(phoneScreenResult(ctx, value as PhoneScreen, phoneNote(action)));
  } catch (error) {
    await auditPhoneAction(ctx, {
      deviceId,
      tool: call.name,
      op: action.op,
      outcome: "error",
      ms: Date.now() - started,
    });
    if (signal.aborted) throw error;
    const reason = redactSecrets(
      error instanceof Error ? error.message : "phone control failed",
      ctx.secrets,
    );
    return call.finish({ error: `The user's phone did not finish: ${reason}` });
  }
};

/** One card per attempt, so a burst of phone tools does not stack the same question. */
async function askToEnablePhoneControl(ctx: RunContext): Promise<void> {
  if (ctx.state.phoneControlAsked) return;
  ctx.state.phoneControlAsked = true;
  await publishMessage(ctx.deps, ctx.run, "bot", [
    {
      kind: "ask",
      text: "Turn on phone control so I can see and use this phone?",
      detail: "This pairs the phone and opens Accessibility if it is still off.",
      detailFormat: "text",
      actions: [
        { id: ENABLE_PHONE_CONTROL_ACTION, label: "Turn on" },
        { id: "deny", label: "Not now" },
      ],
    },
  ]).catch(() => undefined);
}

function phoneNote(action: PhoneAction): string {
  switch (action.op) {
    case "screenshot":
      return "screenshot";
    case "uiTree":
      return "screen";
    case "tap":
      return action.element === undefined
        ? `tapped ${action.x},${action.y}`
        : `tapped [${action.element}]`;
    case "swipe":
      return action.direction ? `swiped ${action.direction}` : "swiped";
    case "type":
      return action.submit ? "typed and pressed enter" : "typed";
    case "key":
      return `pressed ${action.key}`;
    case "openApp":
      return `opened ${action.app}`;
    case "shell":
      return action.privileged ? "ran a deeper command" : "ran";
    case "notifications":
      return action.verb === "list" ? "notifications" : action.verb;
  }
}

export function phoneNotificationResult(ctx: RunContext, result: PhoneNotificationResult) {
  const notifications = result.notifications?.map((item) => ({
    ...item,
    title: redactSecrets(String(item.title ?? ""), ctx.secrets),
    text: redactSecrets(String(item.text ?? ""), ctx.secrets),
    app: redactSecrets(String(item.app ?? ""), ctx.secrets),
  }));
  return {
    ...(notifications ? { notifications } : {}),
    ...(result.done ? { done: result.done } : {}),
  };
}

export function phoneShellResult(ctx: RunContext, result: PhoneShellResult) {
  return {
    exitCode: result.exitCode,
    stdout: redactSecrets(result.stdout, ctx.secrets),
    stderr: redactSecrets(result.stderr, ctx.secrets),
    runner: result.runner,
    ...(result.timedOut ? { timedOut: true } : {}),
    ...(result.truncated ? { truncated: true } : {}),
  };
}

/** Only the app and the screen size are stored; the rows and screenshot reach the model alone. */
export function phoneScreenResult(
  ctx: RunContext,
  screen: PhoneScreen,
  note: string,
): AgentToolExecutionResult {
  const image = ctx.computer.acceptsImages ? screen.image : undefined;
  const details = {
    ...(screen.package ? { package: screen.package } : {}),
    width: screen.image?.width ?? screen.width,
    height: screen.image?.height ?? screen.height,
  };
  const lines = [note, JSON.stringify(details)];
  if (screen.image && !image) lines.push(MODEL_CANNOT_SEE_MESSAGE);
  if (screen.tree) lines.push(redactSecrets(screen.tree, ctx.secrets));
  return {
    kind: "agent_tool_result",
    content: [
      { type: "text", text: lines.join("\n") },
      ...(image ? [{ type: "image" as const, data: image.data, mimeType: image.mimeType }] : []),
    ],
    details,
  };
}
