import type { LocalModelsStatus } from "@atlas/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/query", () => ({ useSpaceQueries: () => ({}) }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: String }) }));

const { contextLabel, localModelFacts } = await import("./local-model-status");

const status: LocalModelsStatus = {
  contextWindow: 16384,
  checkedAt: "2026-10-31T19:00:00.000Z",
  servers: [
    {
      baseUrl: "http://127.0.0.1:11436/v1",
      kind: "llama-server",
      reachable: true,
      contextWindow: 16384,
      models: [
        {
          id: "qwen3.5:4b",
          aliases: ["qwen3.5:4b-mtp"],
          sizeBytes: 2824005632,
          parameterSize: "4.3B",
          contextWindow: 16384,
          large: false,
          loadState: "loaded",
        },
      ],
    },
    {
      baseUrl: "http://127.0.0.1:11434/v1",
      kind: "ollama",
      reachable: true,
      contextWindow: null,
      models: [
        {
          id: "qwen3.5:35b-a3b",
          aliases: [],
          sizeBytes: 22_070_000_000,
          parameterSize: "34.7B",
          contextWindow: null,
          large: true,
          loadState: "unloaded",
        },
      ],
    },
  ],
};

describe("localModelFacts", () => {
  it("finds a model by id or alias with its server's context", () => {
    expect(localModelFacts(status, "qwen3.5:4b-mtp")).toEqual({
      reachable: true,
      contextWindow: 16384,
      atlasContextWindow: 16384,
      large: false,
      loadState: "loaded",
    });
    expect(localModelFacts(status, "qwen3.5:35b-a3b")?.large).toBe(true);
  });

  it("calls a model no server lists offline", () => {
    expect(localModelFacts(status, "gone:7b")?.reachable).toBe(false);
    expect(localModelFacts(undefined, "qwen3.5:4b")).toBeNull();
  });

  it("labels context sizes in K", () => {
    expect(contextLabel(16384)).toBe("16K");
    expect(contextLabel(512)).toBe("512");
  });
});
