import type { RunActivityRow } from "@atlas/contracts";
import { isBackgroundRunTrigger, isRunWaitingOnUser, isRunWorking } from "@atlas/core";

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
};

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
        task: (run?.promptSnippet || bot.preview).trim(),
      };
    })
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
}
