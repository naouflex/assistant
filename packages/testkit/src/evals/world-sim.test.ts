import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRuntime } from "@atlas/adapter-kit";
import { describe, expect, it } from "vitest";
import { createWorldSimulator, worldSimPrompt } from "./world-sim.js";

const world = {
  context: "user: is the bot still running?",
  observed: [
    { name: "user_computer_shell", input: "systemctl status bot", output: "active (running)" },
  ],
};

describe("world simulator", () => {
  it("puts the conversation, the original results and the command in the prompt", () => {
    const prompt = worldSimPrompt(world, "systemctl status bot", "/srv");
    expect(prompt).toContain("is the bot still running?");
    expect(prompt).toContain("active (running)");
    expect(prompt).toContain("(cwd /srv)\nsystemctl status bot");
  });

  it("shows the answers this replay already gave, so later commands stay consistent", () => {
    const prompt = worldSimPrompt(world, "cat bot.log", undefined, [
      { command: "ls /srv", output: "bot.log\nconfig.yml" },
    ]);
    expect(prompt).toContain("## Earlier commands in this replay\n### ls /srv\nbot.log");
    expect(worldSimPrompt(world, "ls")).not.toContain("Earlier commands");
  });

  it("caches answers by case and command, and falls back when the model fails", async () => {
    let calls = 0;
    const runtime = {
      async *run() {
        calls++;
        yield { type: "text", text: "active (running)" };
      },
    } as unknown as AgentRuntime;
    const cacheFile = path.join(mkdtempSync(path.join(tmpdir(), "sim-")), "cache.json");
    const options = { model: {} as never, caseId: "c", world, cacheFile, fallback: "none\n" };
    const sim = createWorldSimulator({ ...options, runtime });
    expect(await sim(["systemctl", "status", "bot"])).toBe("active (running)\n");
    const again = createWorldSimulator({ ...options, runtime });
    expect(await again(["systemctl", "status", "bot"])).toBe("active (running)\n");
    expect(calls).toBe(1);
    const failing = {
      // biome-ignore lint/correctness/useYield: fails before any event
      async *run() {
        throw new Error("down");
      },
    } as unknown as AgentRuntime;
    expect(await createWorldSimulator({ ...options, runtime: failing })(["ls"])).toBe("none\n");
  });
});
