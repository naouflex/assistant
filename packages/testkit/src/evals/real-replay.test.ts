import { describe, expect, it } from "vitest";
import { replayEvalCase } from "./real-replay.js";

describe("real-turn replay", () => {
  const turn = {
    id: "cmwRun_1",
    bot: "Chief",
    botInstructions: "You are Chief.",
    context: [
      { role: "user", text: "My key is sk-abcdef123456, deploy staging" },
      { role: "bot", text: "Deployed." },
      { role: "system", text: "ignored" },
    ],
    user: "Now check prod",
  };

  it("seeds scrubbed history and resends the user's message", () => {
    const replay = replayEvalCase(turn);
    expect(replay.id).toBe("replay-cmwrun-1");
    expect(replay.steps).toEqual([{ ask: "Now check prod" }]);
    expect(replay.botSetup).toEqual({ instructions: "You are Chief." });
    expect(replay.userComputer).toBe("windows");
    expect(replay.history?.messages.map((m) => [m.seq, m.role])).toEqual([
      [0, "user"],
      [1, "bot"],
    ]);
    expect(JSON.stringify(replay.history)).not.toContain("sk-abcdef123456");
  });

  it("passes any turn that ended with a reply or a tool call", () => {
    const grade = replayEvalCase({ ...turn, context: [] }).grade;
    const evidence = { text: "", toolCalls: [] } as unknown as Parameters<typeof grade>[0];
    expect(grade(evidence)[0]?.pass).toBe(false);
    expect(grade({ ...evidence, text: "Done" })[0]?.pass).toBe(true);
  });
});
