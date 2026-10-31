import { describe, expect, it } from "vitest";
import { thinkingIsOn, thinkingToggleLevels } from "./composer-thinking";

describe("composer thinking toggle", () => {
  it("shows only when the model can turn thinking off and on", () => {
    expect(thinkingToggleLevels(["off"])).toBeNull();
    expect(thinkingToggleLevels(["low", "high"])).toBeNull();
    expect(thinkingToggleLevels(undefined)).toBeNull();
    expect(thinkingToggleLevels(["off", "minimal", "low", "medium", "high"])).toEqual({
      off: "off",
      on: "medium",
    });
    expect(thinkingToggleLevels(["off", "high"])).toEqual({ off: "off", on: "high" });
  });

  it("follows the saved level, then the deployment default", () => {
    expect(thinkingIsOn(null, "off")).toBe(false);
    expect(thinkingIsOn("medium", "off")).toBe(true);
    expect(thinkingIsOn("off", undefined)).toBe(false);
    expect(thinkingIsOn(null, undefined)).toBe(true);
  });
});
