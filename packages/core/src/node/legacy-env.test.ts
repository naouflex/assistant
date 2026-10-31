import { describe, expect, it } from "vitest";
import { applyLegacyEnvAliases, atlasEnvName } from "./legacy-env.js";

describe("legacy env aliases", () => {
  it("maps legacy prefixes and infixes onto ATLAS_ names", () => {
    expect(atlasEnvName("RAKAZO_IMAGE_TAG")).toBe("ATLAS_IMAGE_TAG");
    expect(atlasEnvName("SLACK_RAKAZO_BOT_ID")).toBe("SLACK_ATLAS_BOT_ID");
    expect(atlasEnvName("DATABASE_URL")).toBeUndefined();
    expect(atlasEnvName("RAKAZOS_X")).toBeUndefined();
  });

  it("fills unset ATLAS_ names and never overrides an explicit one", () => {
    const env: Record<string, string | undefined> = {
      RAKAZO_LOCAL_MODELS: "qwen3.5:4b",
      RAKAZO_IMAGE_TAG: "old",
      ATLAS_IMAGE_TAG: "new",
      OTHER: "x",
    };
    expect(applyLegacyEnvAliases(env)).toEqual(["ATLAS_LOCAL_MODELS"]);
    expect(env.ATLAS_LOCAL_MODELS).toBe("qwen3.5:4b");
    expect(env.ATLAS_IMAGE_TAG).toBe("new");
  });
});
