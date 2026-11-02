import { describe, expect, it } from "vitest";
import { runServiceTier, staticCatalogSupportsFastTier } from "./pi-service-tier.js";

describe("pi-service-tier", () => {
  it("marks xAI Grok 4.6 and 4.7 for fast tier in the static catalog", () => {
    expect(staticCatalogSupportsFastTier("xai", "grok-4.6")).toBe(true);
    expect(staticCatalogSupportsFastTier("xai", "grok-4.7")).toBe(true);
    expect(staticCatalogSupportsFastTier("xai", "grok-composer-2.5-fast")).toBe(false);
    expect(staticCatalogSupportsFastTier("openai-codex", "gpt-5.3-codex")).toBe(false);
  });

  it("maps the bot toggle to pi-ai service tier", () => {
    expect(runServiceTier(false)).toBeUndefined();
    expect(runServiceTier(null)).toBeUndefined();
    expect(runServiceTier(true)).toBe("fast");
  });
});
