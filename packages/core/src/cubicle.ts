import type { RunActivityRow } from "@atlas/contracts";
import { truncatePlainText } from "./markdown-plain.js";
import { isBackgroundRunTrigger, isRunWaitingOnUser, isRunWorking } from "./run-state.js";

const TASK_MAX = 140;

/** What a desk is doing, in the order the floor lists them. */
export type CubicleKind = "waiting" | "working" | "error" | "idle";

const KIND_ORDER: Record<CubicleKind, number> = {
  waiting: 0,
  working: 1,
  error: 2,
  idle: 3,
};

export type CubicleAgent = {
  id: string;
  name: string;
  status: string;
  preview: string;
  runErrorId: string | null;
  archivedAt: string | null;
};

export type CubicleDesk = {
  id: string;
  name: string;
  kind: CubicleKind;
  /** Run status when one is current, otherwise the bot's own status. */
  status: string;
  task: string;
  run?: RunActivityRow;
};

/** A recent agent-to-agent message surfaced on the floor. */
export type CubicleExchange = {
  runId: string;
  botId: string;
  botName: string;
  peerBotId?: string;
  peerName: string;
  text: string;
  kind: "update" | "request" | "unknown";
  status: string;
  updatedAt: string;
};

function cubicleTask(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= TASK_MAX) return oneLine;
  return `${truncatePlainText(oneLine, TASK_MAX - 1).trimEnd()}…`;
}

function exchangeInteresting(status: string): boolean {
  return isRunWaitingOnUser(status) || status === "failed" || isRunWorking(status);
}

export function cubicleKind(status: string, runError: boolean): CubicleKind {
  if (isRunWaitingOnUser(status)) return "waiting";
  if (isRunWorking(status)) return "working";
  if (status === "failed" || runError) return "error";
  return "idle";
}

/** The run a desk should show: a request for the user beats other live work. */
export function cubicleRun(runs: readonly RunActivityRow[]): RunActivityRow | undefined {
  const visible = runs.filter((run) => !isBackgroundRunTrigger(run.trigger));
  const waiting = visible.filter((run) => isRunWaitingOnUser(run.status));
  const pool = waiting.length > 0 ? waiting : visible.filter((run) => isRunWorking(run.status));
  return [...pool].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

/** One desk per agent. People who need you come first; archived agents stay off the floor. */
export function cubicleDesks(
  bots: readonly CubicleAgent[],
  runs: readonly RunActivityRow[],
): CubicleDesk[] {
  const byBot = new Map<string, RunActivityRow[]>();
  for (const run of runs) {
    const list = byBot.get(run.botId);
    if (list) list.push(run);
    else byBot.set(run.botId, [run]);
  }
  return bots
    .filter((bot) => !bot.archivedAt)
    .map((bot) => {
      const run = cubicleRun(byBot.get(bot.id) ?? []);
      const status = run?.status ?? bot.status;
      const kind = cubicleKind(status, Boolean(bot.runErrorId));
      return {
        id: bot.id,
        name: bot.name,
        kind,
        status,
        task: cubicleTask(run?.promptSnippet || bot.preview),
        run,
      };
    })
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
}

/** Recent bot-to-bot runs, newest first, for the collaboration strip. */
export function cubicleExchanges(
  runs: readonly RunActivityRow[],
  limit = 12,
): CubicleExchange[] {
  const seen = new Set<string>();
  const ordered = [...runs]
    .filter((run) => run.trigger === "bot_message")
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const out: CubicleExchange[] = [];
  for (const run of ordered) {
    if (seen.has(run.runId)) continue;
    seen.add(run.runId);
    const agent = run.agentMessage;
    const peerName =
      agent && agent.kind !== "unknown" ? agent.fromBotName.trim() || "Agent" : "Agent";
    const text = cubicleTask(
      agent && agent.kind !== "unknown" && agent.text.trim()
        ? agent.text.trim()
        : run.promptSnippet.trim(),
    );
    const kind = agent?.kind ?? "unknown";
    if (!text && !exchangeInteresting(run.status)) continue;
    out.push({
      runId: run.runId,
      botId: run.botId,
      botName: run.botName,
      peerBotId: agent && agent.kind !== "unknown" ? agent.fromBotId : undefined,
      peerName,
      text,
      kind,
      status: run.status,
      updatedAt: run.updatedAt,
    });
  }
  const rank = (kind: CubicleExchange["kind"]) =>
    kind === "request" ? 0 : kind === "update" ? 1 : 2;
  return out
    .sort(
      (a, b) => rank(a.kind) - rank(b.kind) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    )
    .slice(0, limit);
}

export function cubicleZoneOrder(): CubicleKind[] {
  return ["waiting", "working", "error", "idle"];
}

export type CubicleFloorInput = {
  spaceId: string;
  spaceName: string;
  bots: readonly CubicleAgent[];
  active: readonly RunActivityRow[];
  recent: readonly RunActivityRow[];
};

/** One space on the cubicle floor: desks from live runs, exchanges from live and recent peer messages. */
export type CubicleFloor = {
  spaceId: string;
  spaceName: string;
  desks: CubicleDesk[];
  exchanges: CubicleExchange[];
  waiting: number;
};

export function cubicleFloor(input: CubicleFloorInput): CubicleFloor {
  const desks = cubicleDesks(input.bots, input.active);
  return {
    spaceId: input.spaceId,
    spaceName: input.spaceName,
    desks,
    exchanges: cubicleExchanges([...input.active, ...input.recent]),
    waiting: desks.filter((desk) => desk.kind === "waiting").length,
  };
}
