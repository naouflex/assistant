import { describe, expect, it } from "vitest";
import { formatWorkingLine, workingElapsedLabel } from "./working-line.js";

describe("formatWorkingLine", () => {
  it("keeps a short status as one line", () => {
    expect(formatWorkingLine("  Working…  ")).toEqual({ action: "Working…" });
    expect(formatWorkingLine("Checking your bots")).toEqual({ action: "Checking your bots" });
    expect(formatWorkingLine("Reading the page")).toEqual({ action: "Reading the page" });
  });

  it("puts the subject after a colon on its own, and sets commands in code", () => {
    expect(formatWorkingLine("Searching the web: injury news")).toEqual({
      action: "Searching the web",
      detail: "injury news",
    });
    expect(formatWorkingLine("Running: pnpm test --filter web")).toEqual({
      action: "Running",
      detail: "pnpm test --filter web",
      code: true,
    });
    expect(formatWorkingLine("Running on your computer: git status")).toEqual({
      action: "Running on your computer",
      detail: "git status",
      code: true,
    });
  });

  it("lifts a path off the verb", () => {
    expect(formatWorkingLine("Reading notes/plan.md")).toEqual({
      action: "Reading",
      detail: "notes/plan.md",
      code: true,
    });
    expect(formatWorkingLine("Writing out.csv")).toEqual({
      action: "Writing",
      detail: "out.csv",
      code: true,
    });
  });
});

describe("workingElapsedLabel", () => {
  it("stays quiet for quick steps, then counts seconds and minutes", () => {
    expect(workingElapsedLabel(2_900)).toBe("");
    expect(workingElapsedLabel(12_400)).toBe("12s");
    expect(workingElapsedLabel(65_000)).toBe("1m 05s");
  });
});
