import { afterEach, describe, expect, it } from "vitest";
import {
  discoverLocalModels,
  localDiscoveryUrls,
  localModelsVersion,
  localServerStatus,
  parseServerModels,
  refreshLocalModels,
  setDiscoveredLocalModels,
} from "./local-model-discovery.js";
import { localProvider } from "./pi-local-provider.js";
import { listPiCatalog } from "./pi-models.js";

const LLAMA = "http://127.0.0.1:11436/v1";
const OLLAMA = "http://127.0.0.1:11434/v1";

function json(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

const llamaBody = {
  data: [
    {
      id: "qwen3.5:4b",
      aliases: ["qwen3.5:4b", "qwen3.5:4b-mtp"],
      architecture: { input_modalities: ["text", "image"] },
    },
  ],
};

const saved = { ...process.env };
afterEach(() => {
  for (const key of [
    "ATLAS_LOCAL_MODELS",
    "ATLAS_LOCAL_MODELS_URL",
    "ATLAS_LOCAL_DISCOVERY_URLS",
  ]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  setDiscoveredLocalModels([]);
});

describe("local model discovery", () => {
  it("scans nothing when no local provider is configured", () => {
    expect(localDiscoveryUrls({})).toEqual([]);
    expect(
      localDiscoveryUrls({ ATLAS_LOCAL_MODELS: "a", ATLAS_LOCAL_DISCOVERY_URLS: "off" }),
    ).toEqual([]);
  });

  it("scans the configured server and the stock Ollama port by default", () => {
    expect(localDiscoveryUrls({ ATLAS_LOCAL_MODELS_URL: `${LLAMA}/` })).toEqual([LLAMA, OLLAMA]);
    expect(
      localDiscoveryUrls({
        ATLAS_LOCAL_MODELS: "a",
        ATLAS_LOCAL_DISCOVERY_URLS: "nope, http://h:1/v1",
      }),
    ).toEqual([OLLAMA, "http://h:1/v1"]);
  });

  it("reads llama-server and Ollama model lists", () => {
    expect(parseServerModels(llamaBody, LLAMA)).toEqual([
      { id: "qwen3.5:4b", aliases: ["qwen3.5:4b-mtp"], baseUrl: LLAMA, images: true },
    ]);
    expect(parseServerModels({ models: [{ name: "gemma3:4b" }, { name: "" }] }, OLLAMA)).toEqual([
      { id: "gemma3:4b", aliases: [], baseUrl: OLLAMA, images: false },
    ]);
    expect(parseServerModels("garbage", OLLAMA)).toEqual([]);
  });

  it("falls back to /api/tags and skips servers that are down", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      calls.push(url);
      if (url === `${LLAMA}/models`) return json(llamaBody);
      if (url === "http://127.0.0.1:11434/api/tags")
        return json({ models: [{ name: "qwen3.5:4b-mtp" }, { name: "gemma3:4b" }] });
      if (url.startsWith("http://down")) throw new Error("ECONNREFUSED");
      return json({}, false);
    };
    const models = await discoverLocalModels(
      { ATLAS_LOCAL_MODELS_URL: LLAMA, ATLAS_LOCAL_DISCOVERY_URLS: `${OLLAMA},http://down:1/v1` },
      fetchImpl,
    );
    // Ollama's qwen3.5:4b-mtp is an alias the llama-server already owns.
    expect(models.map((model) => [model.id, model.baseUrl])).toEqual([
      ["qwen3.5:4b", LLAMA],
      ["gemma3:4b", OLLAMA],
    ]);
    expect(calls).toContain("http://127.0.0.1:11434/api/tags");
  });

  it("adds discovered models to the picker without duplicating configured ones", () => {
    process.env.ATLAS_LOCAL_MODELS = "qwen3.5:4b-mtp";
    process.env.ATLAS_LOCAL_MODELS_URL = LLAMA;
    const before = localModelsVersion();
    expect(
      setDiscoveredLocalModels([
        { id: "qwen3.5:4b", aliases: ["qwen3.5:4b-mtp"], baseUrl: LLAMA, images: true },
        { id: "gemma3:4b", aliases: [], baseUrl: OLLAMA, images: false },
      ]),
    ).toBe(true);
    expect(localModelsVersion()).toBe(before + 1);
    const models = localProvider()?.getModels() ?? [];
    expect(models.map((model) => [model.id, model.baseUrl])).toEqual([
      ["qwen3.5:4b", LLAMA],
      ["gemma3:4b", OLLAMA],
    ]);
    const local = listPiCatalog().filter((entry) => entry.provider === "local");
    expect(local.map((entry) => entry.id)).toEqual(["qwen3.5:4b", "gemma3:4b"]);
    // The same list again is not a change, so caches stay warm.
    expect(
      setDiscoveredLocalModels([
        { id: "qwen3.5:4b", aliases: ["qwen3.5:4b-mtp"], baseUrl: LLAMA, images: true },
        { id: "gemma3:4b", aliases: [], baseUrl: OLLAMA, images: false },
      ]),
    ).toBe(false);
  });
});

describe("local server status", () => {
  const routes: Record<string, unknown> = {
    "http://127.0.0.1:11436/v1/models": {
      data: [{ id: "qwen3.5:4b", meta: { n_ctx: 16384, n_params: 4326350848, size: 2824005632 } }],
    },
    "http://127.0.0.1:11436/props": { default_generation_settings: { n_ctx: 16384 } },
    "http://127.0.0.1:11434/v1/models": { data: [{ id: "gemma3:4b" }, { id: "qwen3:30b-a3b" }] },
    "http://127.0.0.1:11434/api/tags": {
      models: [
        { name: "gemma3:4b", size: 3_350_000_000, details: { parameter_size: "3.9B" } },
        { name: "qwen3:30b-a3b", size: 18_560_000_000, details: { parameter_size: "30.5B" } },
      ],
    },
    "http://127.0.0.1:11434/api/ps": { models: [{ name: "gemma3:4b", context_length: 8192 }] },
  };
  const fetchImpl = (async (url: string) =>
    url in routes ? json(routes[url]) : json({}, false)) as unknown as typeof fetch;

  it("reports reachability, context sizes, and models too big for an 8 GB GPU", async () => {
    const [llama, ollama, gone] = await localServerStatus(
      {
        ATLAS_LOCAL_MODELS_URL: LLAMA,
        ATLAS_LOCAL_DISCOVERY_URLS: `${OLLAMA},http://127.0.0.1:9/v1`,
      },
      fetchImpl,
    );
    expect(llama).toMatchObject({ kind: "llama-server", reachable: true, contextWindow: 16384 });
    expect(llama?.models[0]).toMatchObject({
      id: "qwen3.5:4b",
      contextWindow: 16384,
      parameterSize: "4.3B",
      large: false,
      loadState: null,
    });
    expect(ollama).toMatchObject({ kind: "ollama", reachable: true, contextWindow: null });
    expect(ollama?.models).toEqual([
      expect.objectContaining({
        id: "gemma3:4b",
        contextWindow: 8192,
        large: false,
        loadState: "loaded",
      }),
      expect.objectContaining({
        id: "qwen3:30b-a3b",
        contextWindow: null,
        large: true,
        loadState: "unloaded",
      }),
    ]);
    expect(gone).toMatchObject({ reachable: false, kind: "unknown", models: [] });
  });

  it("refresh rescans and lists new models at once", async () => {
    const env = { ATLAS_LOCAL_DISCOVERY_URLS: OLLAMA };
    expect(await refreshLocalModels(env, fetchImpl)).toBe(true);
    expect(await refreshLocalModels({}, fetchImpl)).toBe(false);
  });

  it("reads a llama router load state and only loads a configured server", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: { method?: string; body?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes(":11436") && url.endsWith("/models") && !init?.method) {
        return json({
          data: [
            { id: "qwen3.5:9B", aliases: ["qwen3.5:9b"], status: { value: "loaded" } },
            { id: "qwen3.5:4B", status: { value: "unloaded" } },
          ],
        });
      }
      if (url.endsWith("/models/load")) return json({ success: true });
      return json({}, false);
    }) as unknown as typeof fetch;
    const { loadLocalModel, localServerStatus: status } = await import(
      "./local-model-discovery.js"
    );
    const [server] = await status({ ATLAS_LOCAL_MODELS_URL: LLAMA }, fetchImpl);
    expect(server?.models.map((model) => [model.id, model.loadState])).toEqual([
      ["qwen3.5:9B", "loaded"],
      ["qwen3.5:4B", "unloaded"],
    ]);
    await loadLocalModel(LLAMA, "qwen3.5:4B", { ATLAS_LOCAL_MODELS_URL: LLAMA }, fetchImpl);
    await expect(
      loadLocalModel(
        "http://evil.test/v1",
        "qwen3.5:4B",
        { ATLAS_LOCAL_MODELS_URL: LLAMA },
        fetchImpl,
      ),
    ).rejects.toThrow(/not a configured/);
    expect(calls.some((call) => call.startsWith("POST http://127.0.0.1:11436/models/load"))).toBe(
      true,
    );
    expect(calls.some((call) => call.includes("evil.test"))).toBe(false);
  });
});
