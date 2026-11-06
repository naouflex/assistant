import type { AssistantMessage, AssistantMessageEvent, ToolCall } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { USE_TOOL } from "./builtin-tool-bridge.js";

function routedCall(call: ToolCall, deferred: ReadonlySet<string>): ToolCall {
  if (!deferred.has(call.name)) return call;
  return { ...call, name: USE_TOOL, arguments: { name: call.name, arguments: call.arguments } };
}

export function routeDeferredCalls(
  message: AssistantMessage,
  deferred: ReadonlySet<string>,
): AssistantMessage {
  if (!message.content.some((part) => part.type === "toolCall" && deferred.has(part.name)))
    return message;
  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "toolCall" ? routedCall(part, deferred) : part,
    ),
  };
}

/**
 * A model often calls a tool outside its list by name instead of through use_tool. Pi answers
 * an unlisted name with "not found" before the executor sees it, so the call never runs and
 * the loop guard never counts it. Rewriting the finished call to use_tool runs it the way
 * use_tool would, with the same approvals and guard.
 */
export function withDeferredCallsRouted(
  stream: AssistantMessageEventStream,
  deferred: ReadonlySet<string>,
): AssistantMessageEventStream {
  if (deferred.size === 0) return stream;
  class Routed extends AssistantMessageEventStream {
    override async *[Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
      for await (const event of stream) {
        if (event.type === "toolcall_end") {
          yield {
            ...event,
            toolCall: routedCall(event.toolCall, deferred),
            partial: routeDeferredCalls(event.partial, deferred),
          };
        } else if (event.type === "done") {
          yield { ...event, message: routeDeferredCalls(event.message, deferred) };
        } else {
          yield event;
        }
      }
    }
    override result(): Promise<AssistantMessage> {
      return stream.result().then((message) => routeDeferredCalls(message, deferred));
    }
  }
  return new Routed();
}
