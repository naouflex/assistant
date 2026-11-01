import { describe, expect, it } from "vitest";
import { exactArithmetic } from "./exact-arithmetic.js";

const populations = {
  role: "assistant",
  content:
    "Lyon has a population of approximately 519,127 in 2026, while Montpellier has about 310,240. Lyon is larger.",
};

describe("exact arithmetic", () => {
  it("computes a product written in words", () => {
    expect(
      exactArithmetic("Compute 17 times 23 with the shell and reply with only the number."),
    ).toEqual({
      expression: "17 * 23",
      value: "391",
    });
  });

  it("computes a parenthesized expression", () => {
    expect(exactArithmetic("What is (17 + 6) * 2?")).toEqual({
      expression: "(17 + 6) * 2",
      value: "46",
    });
  });

  it("subtracts two figures named in the question", () => {
    expect(exactArithmetic("What is the difference between 519,127 and 310,240?")).toEqual({
      expression: "519127 - 310240",
      value: "208887",
    });
  });

  it("subtracts the two figures already in the conversation", () => {
    expect(
      exactArithmetic(
        "What is the difference between those two populations? Reply with only the number.",
        [populations, { role: "assistant", content: "461" }],
      ),
    ).toEqual({ expression: "519127 - 310240", value: "208887" });
  });

  it("picks the larger of two numbers", () => {
    expect(
      exactArithmetic("Which is larger, 208887 or 200000? Reply with only the larger number."),
    ).toEqual({
      expression: "max(208887, 200000)",
      value: "208887",
    });
  });

  it("leaves a person, a name, a reminder, and thanks alone", () => {
    expect(exactArithmetic("Who is Ada Lovelace?")).toBeUndefined();
    expect(exactArithmetic("What's your name again?")).toBeUndefined();
    expect(exactArithmetic("Thanks.")).toBeUndefined();
    expect(exactArithmetic("Remind me tomorrow at 9 to check the city figures.")).toBeUndefined();
    expect(exactArithmetic("What time did you set that reminder for?")).toBeUndefined();
    expect(exactArithmetic("What is the difference between those two?", [])).toBeUndefined();
  });
});
