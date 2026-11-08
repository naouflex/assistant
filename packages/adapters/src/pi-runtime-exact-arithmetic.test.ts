import type { AgentRunRequest } from "@atlas/adapter-kit";
import { describe, expect, it, vi } from "vitest";

vi.mock("@earendil-works/pi-agent-core", () => ({
  Agent: class {
    state: { errorMessage: undefined; messages: Array<Record<string, unknown>> };
    constructor(options: { initialState: { messages: Array<Record<string, unknown>> } }) {
      this.state = { errorMessage: undefined, messages: [...options.initialState.messages] };
    }
    subscribe() {}
    steer() {}
    async prompt() {
      throw new Error("the model should not be prompted");
    }
    async waitForIdle() {}
    abort() {}
  },
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    getModel: (_provider: string, modelId: string) => ({ provider: "test", id: modelId }),
    streamSimple: () => {
      throw new Error("provider should not be called");
    },
  }),
}));

vi.mock("./pi-local-provider.js", () => ({
  registerLocalProvider: (models: unknown) => models,
}));

vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import { PiAgentRuntime } from "./pi-runtime.js";

describe("exact arithmetic replies", () => {
  it("answers with the computed value alone, not the previous reply", async () => {
    const request: AgentRunRequest = {
      botId: "bot",
      threadId: "thread",
      runId: "run",
      prompt: "What is 2 * 3?",
      utterance: "What is 2 * 3?",
      instructions: "test",
      history: [
        { id: "m1", role: "user", content: "Can you reach the project?" },
        { id: "m2", role: "assistant", content: "Yes, I can reach it." },
      ],
      tools: [],
      model: { provider: "test", id: "arithmetic-test-model" },
    };
    let done: string | undefined;
    for await (const event of new PiAgentRuntime().run(request, {
      operationId: "arithmetic-test",
      traceId: "arithmetic-test",
      spaceId: "workspace",
      userId: "user",
      signal: new AbortController().signal,
    })) {
      if (event.type === "done") done = event.text;
    }
    expect(done).toBe("6");
  });
});
