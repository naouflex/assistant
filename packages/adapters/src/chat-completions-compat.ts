import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Api, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

/**
 * OpenAI-compatible servers render `messages` through the model's chat template and
 * validate tool schemas with their own JSON Schema subset. Both are stricter than
 * OpenAI: templates reject a role sequence they were not written for, and validators
 * reject keywords they do not implement. Normalize the wire request in this one place,
 * after every other payload hook, so each chat-completions provider gets the same shape.
 */
export function withChatCompletionsCompatibility<O extends SimpleStreamOptions>(
  model: Pick<Model<Api>, "api" | "id" | "baseUrl"> & { provider?: string; reasoning?: boolean },
  options: O,
  env: Record<string, string | undefined> = process.env,
): O {
  if (model.api !== "openai-completions") return options;
  const previous = options.onPayload;
  const stringContent = requiresStringContent(model);
  const selfHosted = model.provider === "local" || model.provider === "openai-compatible";
  const local = selfHosted
    ? {
        // A thinking-capable model follows the run's level (off arrives as no reasoning);
        // any other self-hosted model keeps the env switch.
        disableThinking: model.reasoning
          ? !options.reasoning
          : localThinkingDisabled(model.provider, env),
      }
    : undefined;
  return {
    ...options,
    async onPayload(payload, requestModel) {
      const replaced = await previous?.(payload, requestModel);
      const normalized =
        normalizeChatCompletionsPayload(replaced ?? payload, { stringContent }) ?? replaced;
      if (!local) return normalized;
      const final = selfHostedPayload(normalized ?? payload, local) ?? normalized;
      dumpLocalPayload(env, final ?? payload);
      return final;
    },
  };
}

/**
 * Diagnostics for self-hosted models: when set to a directory, each final request body is
 * written there as JSON so an operator can read exactly what the model received. Off by default;
 * the bodies hold conversation text, so point it at a private local directory only.
 */
export const LOCAL_PAYLOAD_DUMP_ENV = "ATLAS_DEBUG_LOCAL_PAYLOAD_DIR";

function dumpLocalPayload(env: Record<string, string | undefined>, payload: unknown) {
  const directory = env[LOCAL_PAYLOAD_DUMP_ENV]?.trim();
  if (!directory) return;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync(path.join(directory, name), JSON.stringify(payload, null, 2), { mode: 0o600 });
  } catch {
    // Diagnostics must never break a model call.
  }
}

/** Env switch that turns model thinking off on self-hosted servers (Ollama, llama.cpp, vLLM). */
export const LOCAL_DISABLE_THINKING_ENV = "ATLAS_LOCAL_DISABLE_THINKING";

export function localThinkingDisabled(
  provider: string | undefined,
  env: Record<string, string | undefined>,
): boolean {
  const flag = env[LOCAL_DISABLE_THINKING_ENV]?.trim().toLowerCase();
  if (flag !== "true" && flag !== "1" && flag !== "on") return false;
  return provider === "local" || provider === "openai-compatible";
}

/**
 * Self-hosted servers differ in what they read: Ollama ignores max_completion_tokens and
 * reads max_tokens, `think` and `reasoning_effort`; llama.cpp and vLLM pass
 * chat_template_kwargs to the template (Qwen's enable_thinking). Send each spelling so a
 * cap and a thinking switch hold on all of them. A new payload when anything changed.
 */
export function selfHostedPayload(
  payload: unknown,
  options: { disableThinking?: boolean },
): unknown {
  if (!isRecord(payload)) return undefined;
  const next: Record<string, unknown> = { ...payload };
  let changed = false;
  if (typeof payload.max_completion_tokens === "number" && payload.max_tokens === undefined) {
    next.max_tokens = payload.max_completion_tokens;
    changed = true;
  }
  if (options.disableThinking) {
    const kwargs = isRecord(payload.chat_template_kwargs) ? payload.chat_template_kwargs : {};
    next.chat_template_kwargs = { ...kwargs, enable_thinking: false };
    next.think = false;
    next.reasoning_effort = "none";
    delete next.reasoning;
    changed = true;
  }
  return changed ? next : undefined;
}

/** Workers AI validates every message's content as a string, including tool-call turns. */
function requiresStringContent(model: Pick<Model<Api>, "id" | "baseUrl">): boolean {
  return (
    model.id.startsWith("@cf/") ||
    model.id.startsWith("workers-ai/") ||
    model.baseUrl.includes("api.cloudflare.com")
  );
}

/**
 * Validation-only keywords that OpenAI-compatible validators reject outright. Tool
 * arguments are still validated locally against the original schema, so dropping them
 * from the wire keeps the constraint.
 */
const UNSUPPORTED_TOOL_SCHEMA_KEYWORDS = new Set(["uniqueItems"]);

type ChatMessage = Record<string, unknown> & { role?: unknown; content?: unknown };
type Part = Record<string, unknown>;

/** A new payload when anything changed, otherwise undefined. */
export function normalizeChatCompletionsPayload(
  payload: unknown,
  options: { stringContent?: boolean } = {},
): unknown {
  if (!isRecord(payload)) return undefined;
  const messages = Array.isArray(payload.messages)
    ? normalizeMessages(payload.messages as ChatMessage[], options)
    : undefined;
  const tools = Array.isArray(payload.tools) ? normalizeTools(payload.tools) : undefined;
  if (!messages && !tools) return undefined;
  return {
    ...payload,
    ...(messages ? { messages } : {}),
    ...(tools ? { tools } : {}),
  };
}

/**
 * - one leading instruction message: consecutive leading system/developer messages merge
 * - no two user turns in a row (history, steering and follow-ups arrive as separate messages)
 * - no two plain assistant texts in a row
 * - text-only content as a plain string, which every template renders
 */
function normalizeMessages(
  messages: ChatMessage[],
  options: { stringContent?: boolean },
): ChatMessage[] | undefined {
  const result: ChatMessage[] = [];
  let changed = false;
  for (const original of messages) {
    let message = original;
    const flattened = flattenTextContent(message.content);
    if (flattened !== message.content) {
      message = { ...message, content: flattened };
      changed = true;
    }
    if (
      options.stringContent &&
      message.role === "assistant" &&
      (message.content === null || message.content === undefined)
    ) {
      message = { ...message, content: "" };
      changed = true;
    }
    const last = result.at(-1);
    if (last && canMerge(last, message, result.length === 1)) {
      result[result.length - 1] = {
        ...message,
        role: last.role,
        content: joinContent(last.content, message.content),
      };
      changed = true;
      continue;
    }
    result.push(message);
  }
  return changed ? result : undefined;
}

const INSTRUCTION_ROLES = new Set(["system", "developer"]);

function canMerge(previous: ChatMessage, next: ChatMessage, previousIsFirst: boolean): boolean {
  if (
    previousIsFirst &&
    INSTRUCTION_ROLES.has(String(previous.role)) &&
    INSTRUCTION_ROLES.has(String(next.role))
  ) {
    return isPlain(previous) && isPlain(next);
  }
  if (previous.role !== next.role) return false;
  if (next.role === "user") return isPlain(previous) && isPlain(next);
  // An assistant tool call must stay directly before its results.
  if (next.role === "assistant") return isPlain(previous);
  return false;
}

/** Only role and content: nothing else (tool calls, names, reasoning) to reconcile. */
function isPlain(message: ChatMessage): boolean {
  return Object.keys(message).every((key) => key === "role" || key === "content");
}

function flattenTextContent(content: unknown): unknown {
  if (!Array.isArray(content) || content.length === 0) return content;
  const texts: string[] = [];
  for (const part of content as unknown[]) {
    if (
      !isRecord(part) ||
      part.type !== "text" ||
      typeof part.text !== "string" ||
      Object.keys(part).length !== 2
    ) {
      return content;
    }
    texts.push(part.text);
  }
  return texts.join("\n");
}

function joinContent(left: unknown, right: unknown): unknown {
  if (isEmpty(left)) return right;
  if (isEmpty(right)) return left;
  if (typeof left === "string" && typeof right === "string") return `${left}\n\n${right}`;
  return [...toParts(left), ...toParts(right)];
}

function isEmpty(content: unknown): boolean {
  return (
    content === null ||
    content === undefined ||
    content === "" ||
    (Array.isArray(content) && content.length === 0)
  );
}

function toParts(content: unknown): Part[] {
  if (Array.isArray(content)) return content as Part[];
  return [{ type: "text", text: String(content) }];
}

function normalizeTools(tools: unknown[]): unknown[] | undefined {
  let changed = false;
  const next = tools.map((tool) => {
    if (!isRecord(tool) || !isRecord(tool.function) || !("parameters" in tool.function)) {
      return tool;
    }
    const parameters = withoutUnsupportedKeywords(tool.function.parameters);
    if (parameters === tool.function.parameters) return tool;
    changed = true;
    return { ...tool, function: { ...tool.function, parameters } };
  });
  return changed ? next : undefined;
}

/** Keywords whose values map names to subschemas, so their keys are names, not keywords. */
const SCHEMA_MAPS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);
/** Keywords whose values are data, never schemas. */
const SCHEMA_DATA = new Set(["enum", "const", "default", "examples", "required"]);

/** The schema without unsupported keywords; the same object when nothing was removed. */
export function withoutUnsupportedKeywords(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    const next = schema.map(withoutUnsupportedKeywords);
    return next.some((value, index) => value !== schema[index]) ? next : schema;
  }
  if (!isRecord(schema)) return schema;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_TOOL_SCHEMA_KEYWORDS.has(key)) {
      changed = true;
      continue;
    }
    const sanitized = SCHEMA_DATA.has(key)
      ? value
      : SCHEMA_MAPS.has(key) && isRecord(value)
        ? sanitizeSchemaMap(value)
        : withoutUnsupportedKeywords(value);
    if (sanitized !== value) changed = true;
    next[key] = sanitized;
  }
  return changed ? next : schema;
}

function sanitizeSchemaMap(map: Record<string, unknown>): Record<string, unknown> {
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(map)) {
    const sanitized = withoutUnsupportedKeywords(schema);
    if (sanitized !== schema) changed = true;
    next[name] = sanitized;
  }
  return changed ? next : map;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
