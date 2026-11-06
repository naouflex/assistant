import { describe, expect, it } from "vitest";
import { redactCliError } from "./admin-bot-errors.js";

describe("redactCliError", () => {
  it("truncates long messages and collapses whitespace", () => {
    const long = "x".repeat(200);
    expect(redactCliError(long).endsWith("…")).toBe(true);
    expect(redactCliError(long).length).toBeLessThanOrEqual(160);
    expect(redactCliError("a\n\tb  c")).toBe("a b c");
  });
});
