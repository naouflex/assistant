import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { PiAgentRuntime } from "./pi-runtime.js";

type WireMessage = { role: string; content: unknown };

async function captureWire(
  history: Array<{ id: string; role: "user" | "assistant"; content: string }>,
  contextStrategy?: "current" | "retrieval",
) {
  const requests: Array<{ messages: WireMessage[] }> = [];
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "Ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    })().catch(() => response.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture endpoint unavailable");
  try {
    for await (const _ of new PiAgentRuntime().run(
      {
        botId: "bot-fixture",
        threadId: "thread-fixture",
        runId: "run-history-wire",
        prompt: "And in Spanish?",
        instructions: "Answer briefly.",
        history,
        tools: [],
        ...(contextStrategy ? { contextStrategy } : {}),
        model: {
          provider: "openai-compatible",
          id: "fixture",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          allowPrivateEndpoint: true,
          contextWindow: 16_384,
          maxTokens: 2048,
        },
      },
      { signal: AbortSignal.timeout(15_000) },
    )) {
      // drain
    }
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, "close");
  }
  return requests[0]!.messages.filter(
    (message) => message.role !== "system" && message.role !== "developer",
  );
}

const text = (content: unknown) =>
  typeof content === "string"
    ? content
    : (content as Array<{ text?: string }>).map((part) => part.text ?? "").join("");

describe("history on the wire", () => {
  it.each([undefined, "current", "retrieval"] as const)(
    "replays earlier replies as separate assistant turns (strategy %s)",
    async (strategy) => {
      const wire = await captureWire(
        [
          { id: "m0", role: "assistant", content: "Hi, I'm Chief." },
          { id: "m1", role: "user", content: "hello" },
          { id: "m2", role: "assistant", content: "Hello! How can I help?" },
          { id: "m3", role: "user", content: "Translate to French: Where is the train station?" },
          { id: "m4", role: "assistant", content: "O? est la gare ?" },
        ],
        strategy,
      );
      // The opening greeting stays its own assistant turn instead of merging into "hello".
      expect(wire.map((message) => message.role)).toEqual([
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
        "user",
      ]);
      expect(text(wire[1]!.content)).toBe("hello");
      expect(text(wire.at(-1)!.content)).toContain("And in Spanish?");
      expect(text(wire.at(-1)!.content)).not.toContain("train station");
      expect(text(wire.at(-2)!.content)).toBe("O? est la gare ?");
    },
    30_000,
  );
});
