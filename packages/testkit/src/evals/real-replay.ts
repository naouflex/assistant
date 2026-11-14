import { readFileSync } from "node:fs";
import type { EvalCase } from "./cases.js";
import { scrubTurnText } from "./real-turns.js";

/**
 * Replays exported real turns on the current code: the recent conversation is seeded as history,
 * the user's message is sent again, and what the bot does is kept for the real-turn rubric. The
 * export stays on the operator's machine; tools run against the eval's fake services, so only the
 * comparison between two code revisions on the same export is meaningful.
 */
export const REAL_REPLAY_VERSION = "real-replay-v2";

/** What every command on the replayed owner's PC prints: the real output is not part of the export. */
export const REPLAY_COMPUTER_OUTPUT =
  "(replay: the command ran on the owner's PC; its output is not available in this replay)\n";

export type ReplayTurn = {
  id: string;
  bot: string;
  botInstructions?: string | null;
  context: Array<{ role: string; text: string }>;
  user: string;
};

export function replayEvalCase(turn: ReplayTurn): EvalCase {
  const history = turn.context
    .filter((m) => (m.role === "user" || m.role === "bot") && m.text.trim())
    .map((m, seq) => ({
      seq,
      role: m.role as "user" | "bot",
      text: scrubTurnText(m.text),
      createdAt: new Date(Date.now() - (turn.context.length - seq) * 60_000),
    }));
  return {
    id: `replay-${turn.id}`.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
    purpose: `[replay] a real turn of ${turn.bot}`,
    connections: [],
    pauseEndsTurn: true,
    // Most real turns work through the owner's PC; without it every one of them stalls the same way.
    userComputer: "windows",
    ...(turn.botInstructions?.trim()
      ? { botSetup: { instructions: scrubTurnText(turn.botInstructions) } }
      : {}),
    ...(history.length
      ? { history: { messages: history, ask: turn.user, required: [], forbidden: [] } }
      : {}),
    steps: [{ ask: scrubTurnText(turn.user) }],
    // Graded afterwards with the real-turn rubric; here the turn only has to end.
    grade: (e) => [{ id: "turn-ended", pass: Boolean(e.text.trim() || e.toolCalls.length) }],
  };
}

/** Reads replay turns (one JSON object per line) from a file kept outside the repo. */
export function loadReplayCases(file: string): EvalCase[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => replayEvalCase(JSON.parse(line) as ReplayTurn));
}
