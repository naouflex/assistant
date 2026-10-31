import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { withChatCompletionsCompatibility } from "./chat-completions-compat.js";
import { localModelThinks } from "./pi-local-provider.js";

const local = {
  api: "openai-completions" as const,
  id: "qwen3.5:4b",
  baseUrl: "http://127.0.0.1:11434/v1",
  provider: "local",
};
const env = { ATLAS_LOCAL_DISABLE_THINKING: "true" };

async function wire(model: typeof local & { reasoning?: boolean }, reasoning?: "medium") {
  const options = withChatCompletionsCompatibility(
    model,
    { reasoning } as SimpleStreamOptions,
    env,
  );
  const payload = { model: model.id, messages: [{ role: "user", content: "hi" }] };
  return ((await options.onPayload?.(payload, model as never)) ?? payload) as Record<
    string,
    unknown
  >;
}

describe("local thinking toggle", () => {
  it("sends the disable switches when thinking is off", async () => {
    const body = await wire({ ...local, reasoning: true });
    expect(body.think).toBe(false);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("lets a thinking-capable model think when the run asks for it, despite the env default", async () => {
    const body = await wire({ ...local, reasoning: true }, "medium");
    expect(body.think).toBeUndefined();
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  it("keeps the env switch for models that cannot think", async () => {
    const body = await wire({ ...local, id: "llama3.1:8b", reasoning: false }, "medium");
    expect(body.think).toBe(false);
  });

  it("detects thinking models by name, or by the declared list", () => {
    expect(localModelThinks("qwen3.5:4b", {})).toBe(true);
    expect(localModelThinks("qwen2.5:7b-instruct", {})).toBe(false);
    expect(localModelThinks("llama3.1:8b", {})).toBe(false);
    expect(localModelThinks("llama3.1:8b", { ATLAS_LOCAL_REASONING_MODELS: "llama3.1:8b" })).toBe(
      true,
    );
    expect(localModelThinks("qwen3.5:4b", { ATLAS_LOCAL_REASONING_MODELS: "other" })).toBe(false);
  });
});
