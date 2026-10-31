import { expect, test } from "vitest";
import { workingElapsedLabel } from "./working-elapsed";

test("stays quiet for quick steps, then counts seconds and minutes", () => {
  expect(workingElapsedLabel(2_900)).toBe("");
  expect(workingElapsedLabel(12_400)).toBe("12s");
  expect(workingElapsedLabel(65_000)).toBe("1m 05s");
});
