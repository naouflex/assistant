import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { AgentRunModel, AgentRuntime } from "@atlas/adapter-kit";

/** A tool call from the original run of a replayed turn, kept so the simulator stays close to it. */
export type ReplayObserved = { name: string; input: string; output: string };

/** What the replayed owner's PC knew: the conversation and the original run's tool results. */
export type ReplayWorld = { context: string; observed: ReplayObserved[] };

const SIM_INSTRUCTIONS = `You stand in for the owner's Windows PC (with WSL) in a replay of a real conversation with an AI agent. The agent ran a command on that PC; reply with only what the command would print (stdout and stderr together), nothing else: no commentary, no code fences.
Stay consistent with the conversation and, above all, with the tool results of the original run listed below: when the command matches or overlaps one of them, reuse that output. Otherwise invent output that is plausible for this machine and project. A command that would fail prints its real error. Keep it under 60 lines; elide long middles with "...".`;

const MAX_OBSERVED_CHARS = 24_000;

export function worldSimPrompt(world: ReplayWorld, command: string, cwd?: string): string {
  let observed = "";
  for (const call of world.observed) {
    const entry = `### ${call.name} ${call.input}\n${call.output}\n\n`;
    if (observed.length + entry.length > MAX_OBSERVED_CHARS) break;
    observed += entry;
  }
  return [
    `## Conversation\n${world.context}`,
    `## Tool results of the original run\n${observed || "(none)"}`,
    `## Command to answer${cwd ? ` (cwd ${cwd})` : ""}\n${command}`,
  ].join("\n\n");
}

/**
 * Answers commands on the replayed PC with a model, cached by case and command in `cacheFile`
 * so two code revisions that run the same command see the same output.
 */
export function createWorldSimulator(options: {
  runtime: AgentRuntime;
  model: AgentRunModel;
  caseId: string;
  world: ReplayWorld;
  cacheFile: string;
  fallback: string;
}): (argv: string[], cwd?: string) => Promise<string> {
  return async (argv, cwd) => {
    const command = argv.join(" ");
    const key = createHash("sha256")
      .update(JSON.stringify([options.caseId, cwd ?? "", argv]))
      .digest("hex");
    const cache: Record<string, string> = existsSync(options.cacheFile)
      ? (JSON.parse(readFileSync(options.cacheFile, "utf8")) as Record<string, string>)
      : {};
    if (cache[key] !== undefined) return cache[key]!;
    const id = randomUUID();
    let text = "";
    try {
      for await (const event of options.runtime.run(
        {
          botId: id,
          threadId: id,
          runId: id,
          instructions: SIM_INSTRUCTIONS,
          prompt: worldSimPrompt(options.world, command, cwd),
          history: [],
          tools: [],
          model: options.model,
        },
        {
          operationId: id,
          traceId: id,
          spaceId: id,
          userId: id,
          signal: AbortSignal.timeout(120_000),
        },
      )) {
        if (event.type === "text") text += event.text;
      }
    } catch {
      return options.fallback;
    }
    const output = text.trim() ? `${text.trim()}\n` : options.fallback;
    const latest: Record<string, string> = existsSync(options.cacheFile)
      ? (JSON.parse(readFileSync(options.cacheFile, "utf8")) as Record<string, string>)
      : {};
    writeFileSync(options.cacheFile, JSON.stringify({ ...latest, [key]: output }), { mode: 0o600 });
    return output;
  };
}
