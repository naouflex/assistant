import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { expect, test } from "vitest";
import { routeDeferredCalls, withDeferredCallsRouted } from "./pi-deferred-tool-calls.js";

function reply(calls: Array<{ name: string; arguments: Record<string, unknown> }>) {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "Looking." },
      ...calls.map((call, index) => ({ type: "toolCall", id: `call-${index}`, ...call })),
    ],
    stopReason: "toolUse",
    timestamp: 1,
  } as unknown as AssistantMessage;
}

test("a call to a deferred tool by name runs through use_tool", () => {
  const routed = routeDeferredCalls(
    reply([
      { name: "list_files", arguments: { path: "." } },
      { name: "shell", arguments: { command: "ls" } },
    ]),
    new Set(["list_files"]),
  );
  expect(routed.content).toEqual([
    { type: "text", text: "Looking." },
    {
      type: "toolCall",
      id: "call-0",
      name: "use_tool",
      arguments: { name: "list_files", arguments: { path: "." } },
    },
    { type: "toolCall", id: "call-1", name: "shell", arguments: { command: "ls" } },
  ]);
});

test("a reply without deferred calls is returned as is", () => {
  const message = reply([{ name: "shell", arguments: { command: "ls" } }]);
  expect(routeDeferredCalls(message, new Set(["list_files"]))).toBe(message);
});

test("the finished message and done event carry the routed call", async () => {
  const inner = createAssistantMessageEventStream();
  const message = reply([{ name: "list_files", arguments: { path: "." } }]);
  inner.push({ type: "done", reason: "toolUse", message });
  const stream = withDeferredCallsRouted(inner, new Set(["list_files"]));
  const events = [];
  for await (const event of stream) events.push(event);
  const finished = await stream.result();
  expect(finished.content[1]).toMatchObject({ name: "use_tool" });
  expect(events[0]).toMatchObject({
    type: "done",
    message: { content: [{ type: "text" }, { name: "use_tool" }] },
  });
});
