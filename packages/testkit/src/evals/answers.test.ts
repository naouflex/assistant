import { describe, expect, it } from "vitest";
import { ANSWER_EVAL_CASES, ANSWER_JUDGE_CALIBRATION, ANSWER_JUDGE_VERSION } from "./answers.js";
import type { Evidence } from "./cases.js";
import { EMPTY_SETTINGS } from "./cases.js";
import { EvalServices } from "./services.js";

function evidence(patch: Partial<Evidence> = {}): Evidence {
  return {
    text: "",
    files: {},
    records: new EvalServices().records,
    notes: [],
    calls: [],
    routines: [],
    memory: "",
    approvalPending: false,
    pendingApproval: null,
    priorMemory: "",
    toolNames: [],
    toolCalls: [],
    finalStep: 1,
    settings: EMPTY_SETTINGS,
    settingsBefore: EMPTY_SETTINGS,
    messaging: { originThreadId: null, outbound: [] },
    ...patch,
  };
}

const bakery = ANSWER_EVAL_CASES.find((item) => item.id === "answer-bakery-status")!;
const missing = ANSWER_EVAL_CASES.find((item) => item.id === "answer-missing-customer")!;

describe("answer evals", () => {
  it("passes the structural grade only after a read that writes nothing", () => {
    const read = evidence({
      calls: [{ tool: "CRM_LIST_RECORDS", args: {}, outcome: "read" }],
    });
    expect(bakery.grade(read).every((item) => item.pass)).toBe(true);
    expect(missing.grade(read).every((item) => item.pass)).toBe(true);
    expect(bakery.grade(evidence()).every((item) => item.pass)).toBe(false);
    expect(
      bakery
        .grade(
          evidence({
            calls: [{ tool: "CRM_UPDATE_RECORD", args: {}, outcome: "write" }],
          }),
        )
        .every((item) => item.pass),
    ).toBe(false);
  });

  it("asks the judge whether the reply matches the records, and calibrates both ways", () => {
    const judged = bakery.judge!(
      evidence({
        text: "Example Bakery is a lead with normal priority.",
        calls: [{ tool: "CRM_LIST_RECORDS", args: {}, outcome: "read" }],
      }),
    );
    expect(judged.rubric.startsWith(ANSWER_JUDGE_VERSION)).toBe(true);
    expect(judged.evidence).toMatchObject({
      expected: "known",
      customer: "Example Bakery",
      records: expect.arrayContaining([
        expect.objectContaining({ name: "Example Bakery", status: "lead", priority: "normal" }),
      ]),
    });
    expect(ANSWER_JUDGE_CALIBRATION.some((label) => label.pass)).toBe(true);
    expect(ANSWER_JUDGE_CALIBRATION.some((label) => !label.pass)).toBe(true);
    for (const label of ANSWER_JUDGE_CALIBRATION) {
      expect(label.input.rubric).toBe(judged.rubric);
    }
  });
});
