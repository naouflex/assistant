import type { AgentRuntime, AgentRuntimeEvent } from "@atlas/adapter-kit";
import { describe, expect, it } from "vitest";
import { classifyModelTier, parseModelTier, routesTrigger } from "./model-tier-router.js";

const input = {
  botId: "bot",
  threadId: "thread",
  runId: "run",
  spaceId: "space",
  userId: "user",
  text: "Refactor the billing module and plan the migration",
  model: { provider: "test", id: "light" },
};

function runtimeAnswering(events: AgentRuntimeEvent[] | Error): Pick<AgentRuntime, "run"> {
  return {
    run: async function* () {
      if (events instanceof Error) throw events;
      yield* events;
    },
  };
}

describe("parseModelTier", () => {
  it("reads the tier from strict or wrapped JSON", () => {
    expect(parseModelTier('{"tier":"heavy"}')).toBe("heavy");
    expect(parseModelTier('Sure: {"tier": "light"}')).toBe("light");
  });

  it("rejects anything that is not a known tier", () => {
    expect(parseModelTier('{"tier":"opus"}')).toBeNull();
    expect(parseModelTier("heavy")).toBeNull();
    expect(parseModelTier("{not json}")).toBeNull();
  });
});

describe("classifyModelTier", () => {
  it("returns the classified tier and records unaccounted usage", async () => {
    const usage: unknown[] = [];
    const tier = await classifyModelTier(
      runtimeAnswering([
        { type: "usage", inputTokens: 10, outputTokens: 3 } as AgentRuntimeEvent,
        { type: "done", text: '{"tier":"heavy"}' } as AgentRuntimeEvent,
      ]),
      { ...input, onUsage: async (event) => void usage.push(event) },
    );
    expect(tier).toBe("heavy");
    expect(usage).toHaveLength(1);
  });

  it("keeps the main model when the answer is unusable", async () => {
    const tier = await classifyModelTier(
      runtimeAnswering([{ type: "done", text: "I think it's hard" } as AgentRuntimeEvent]),
      input,
    );
    expect(tier).toBe("main");
  });

  it("keeps the main model when the classifier fails", async () => {
    expect(await classifyModelTier(runtimeAnswering(new Error("offline")), input)).toBe("main");
  });
});

describe("routesTrigger", () => {
  it("routes only turns a person sent", () => {
    expect(routesTrigger("user")).toBe(true);
    expect(routesTrigger("messaging")).toBe(true);
    expect(routesTrigger("routine")).toBe(false);
    expect(routesTrigger("bot_message")).toBe(false);
  });
});
