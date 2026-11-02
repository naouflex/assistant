import type { Model, MutableModels, Provider } from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
/**
 * Local OpenAI-compatible model server (Ollama, LM Studio, llama.cpp, MLX).
 * The server is keyless, but `resolve` returns a placeholder because Models
 * hides providers with no resolvable auth.
 */
import { discoveredLocalModels } from "./local-model-discovery.js";
import { LOCAL_PROVIDER_ID } from "./local-provider-identity.js";
import { declaredVisionModelIds, inputModalities } from "./model-modalities.js";

export { LOCAL_PROVIDER_ID, localCacheCapabilities } from "./local-provider-identity.js";

/** Model ids the local server serves with vision, declared by the operator. */
export const LOCAL_VISION_MODELS_ENV = "ATLAS_LOCAL_VISION_MODELS";

/** Model ids the local server can think with; unset means a name heuristic. */
export const LOCAL_REASONING_MODELS_ENV = "ATLAS_LOCAL_REASONING_MODELS";

const THINKING_MODEL_NAME = /qwen3|qwq|deepseek-r1|gpt-oss|magistral|spark-x|reason|think/i;

/** Whether a local model can switch thinking on, so the chat offers a thinking toggle. */
export function localModelThinks(
  id: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const declared = env[LOCAL_REASONING_MODELS_ENV]?.trim();
  if (declared) {
    return declared
      .split(",")
      .map((entry) => entry.trim())
      .includes(id);
  }
  return THINKING_MODEL_NAME.test(id) && !/instruct/i.test(id);
}

export function localVisionModelIds(): ReadonlySet<string> {
  return declaredVisionModelIds(LOCAL_VISION_MODELS_ENV);
}

const DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 4_096;

export function localBaseUrl(): string {
  const value = process.env.ATLAS_LOCAL_MODELS_URL?.trim() || DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("ATLAS_LOCAL_MODELS_URL must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("ATLAS_LOCAL_MODELS_URL must be an absolute HTTP(S) URL");
  }
  return value;
}

/** Throws instead of `Number(x) || default`, which would swallow a typo or accept a negative window. */
function tokenLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return value;
}

/** Comma-separated model ids exactly as the local server names them. */
function configuredLocalModelIds(): string[] {
  return (process.env.ATLAS_LOCAL_MODELS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

type LocalModelSpec = { id: string; baseUrl: string; images: boolean };

/**
 * The names the servers report come first, so each model is one row under the id
 * Load uses. A configured id is added only when it is not already that id or an alias.
 */
function localModelSpecs(): LocalModelSpec[] {
  const base = localBaseUrl();
  const vision = localVisionModelIds();
  const specs: LocalModelSpec[] = [];
  const taken = new Set<string>();
  const claim = (names: string[]) => {
    for (const name of names) taken.add(name);
  };
  for (const model of discoveredLocalModels()) {
    const names = [model.id, ...model.aliases];
    if (names.some((name) => taken.has(name))) continue;
    claim(names);
    specs.push({
      id: model.id,
      baseUrl: model.baseUrl,
      images: names.some((name) => vision.has(name)) || model.images,
    });
  }
  for (const id of configuredLocalModelIds()) {
    if (taken.has(id)) continue;
    claim([id]);
    specs.push({ id, baseUrl: base, images: vision.has(id) });
  }
  return specs;
}

function localModel(spec: LocalModelSpec): Model<"openai-completions"> {
  const { id } = spec;
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: LOCAL_PROVIDER_ID,
    baseUrl: spec.baseUrl,
    reasoning: localModelThinks(id),
    compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
    input: inputModalities(spec.images),
    // Runs on the operator's own hardware, so there is nothing to bill.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: tokenLimit("ATLAS_LOCAL_CONTEXT_WINDOW", DEFAULT_CONTEXT_WINDOW),
    maxTokens: tokenLimit("ATLAS_LOCAL_MAX_TOKENS", DEFAULT_MAX_TOKENS),
  };
}

/** Context window Atlas assumes for every local model (ATLAS_LOCAL_CONTEXT_WINDOW). */
export function localContextWindow(): number {
  return tokenLimit("ATLAS_LOCAL_CONTEXT_WINDOW", DEFAULT_CONTEXT_WINDOW);
}

export function localProvider(): Provider | undefined {
  const specs = localModelSpecs();
  if (!specs.length) return undefined;
  return createProvider({
    id: LOCAL_PROVIDER_ID,
    name: "Local (Ollama / llama.cpp / LM Studio)",
    baseUrl: localBaseUrl(),
    auth: {
      apiKey: {
        name: "Local model server",
        resolve: async () => ({
          // No baseUrl here: it would override each model's own server, and
          // discovered models can live on another local server than the default.
          auth: { apiKey: "local" },
          source: "local model server",
        }),
      },
    },
    models: specs.map(localModel),
    api: openAICompletionsApi(),
  });
}

export function registerLocalProvider(models: MutableModels): MutableModels {
  const provider = localProvider();
  if (provider) models.setProvider(provider);
  return models;
}
