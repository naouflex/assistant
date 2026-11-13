import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it } from "vitest";
import { liveModelSibling, sameModelLine } from "./pi-live-model.js";
import { resolveRuntimeModel } from "./pi-runtime-models.js";

describe("sameModelLine", () => {
  it("joins date, alias and point-release variants of one named line", () => {
    expect(sameModelLine("vendor/name-5.2", "vendor/name-5.1")).toBe(true);
    expect(sameModelLine("vendor/name-5.2", "vendor/name-5")).toBe(true);
    expect(sameModelLine("vendor/name-2026-01-31", "vendor/name")).toBe(true);
    expect(sameModelLine("vendor/name-latest", "vendor/name")).toBe(true);
  });
  it("keeps different lines and bare versions apart", () => {
    expect(sameModelLine("vendor/name-5.2", "vendor/other-5.2")).toBe(false);
    expect(sameModelLine("vendor/name-mini-5.2", "vendor/name-5.2")).toBe(false);
    expect(sameModelLine("vendor/7", "vendor/6")).toBe(false);
  });
});

describe("liveModelSibling", () => {
  const models = builtinModels();
  const cataloged = models
    .getProvider("openrouter")
    ?.getModels()
    .find(
      (model) => /-\d+\.\d+$/.test(model.id) && model.reasoning && model.input.includes("image"),
    );

  it("gives a newer point release its line's reasoning, images and window", () => {
    expect(cataloged).toBeDefined();
    const newer = cataloged!.id.replace(/(\d+)$/, (minor) => String(Number(minor) + 7));
    expect(models.getModel("openrouter", newer)).toBeUndefined();
    const sibling = liveModelSibling(models, "openrouter", newer);
    expect(sibling).toMatchObject({ id: newer, reasoning: true });
    // Its line's window, not the 16k guess that left a thinking model 4k of output.
    expect(sibling!.contextWindow).toBeGreaterThan(16_384);
    expect(sibling?.input).toContain("image");
  });

  it("resolves an unlisted point release with room to think and answer", () => {
    const newer = cataloged!.id.replace(/(\d+)$/, (minor) => String(Number(minor) + 7));
    const previous = process.env.PI_DEFAULT_MODEL;
    process.env.PI_DEFAULT_MODEL = newer;
    try {
      const { model } = resolveRuntimeModel({ provider: "openrouter", id: newer });
      expect(model?.reasoning).toBe(true);
      expect(model!.contextWindow).toBeGreaterThan(16_384);
    } finally {
      if (previous === undefined) delete process.env.PI_DEFAULT_MODEL;
      else process.env.PI_DEFAULT_MODEL = previous;
    }
  });
});
