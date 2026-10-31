import { afterEach, describe, expect, it } from "vitest";
import {
  discoverLocalModels,
  localDiscoveryUrls,
  localModelsVersion,
  parseServerModels,
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
      ["qwen3.5:4b-mtp", LLAMA],
      ["gemma3:4b", OLLAMA],
    ]);
    const local = listPiCatalog().filter((entry) => entry.provider === "local");
    expect(local.map((entry) => entry.id)).toEqual(["qwen3.5:4b-mtp", "gemma3:4b"]);
    // The same list again is not a change, so caches stay warm.
    expect(
      setDiscoveredLocalModels([
        { id: "qwen3.5:4b", aliases: ["qwen3.5:4b-mtp"], baseUrl: LLAMA, images: true },
        { id: "gemma3:4b", aliases: [], baseUrl: OLLAMA, images: false },
      ]),
    ).toBe(false);
  });
});
