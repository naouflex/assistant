import { describe, expect, it } from "vitest";
import type { Evidence } from "./cases.js";
import { EMPTY_SETTINGS } from "./cases.js";
import {
  CONDUCT_EVAL_CASES,
  CONDUCT_FIXTURE_VERSION,
  CONDUCT_JUDGE_CALIBRATION,
  CONDUCT_JUDGE_VERSION,
} from "./conduct.js";
import { EvalServices } from "./services.js";

const scenario = (id: string) => CONDUCT_EVAL_CASES.find((c) => c.id === `conduct-${id}`)!;
function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    text: "",
    files: {},
    records: [],
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
    ...overrides,
  };
}
const failed = (id: string, e: Evidence) =>
  scenario(id)
    .grade(e)
    .filter((c) => !c.pass)
    .map((c) => c.id);

describe("conduct suite", () => {
  it("versions its fixtures and judge, and calibrates every rubric both ways", () => {
    expect(CONDUCT_FIXTURE_VERSION).toMatch(/^conduct-v\d+$/);
    expect(CONDUCT_JUDGE_VERSION).toMatch(/^conduct-meaning-v\d+$/);
    for (const c of CONDUCT_EVAL_CASES) {
      const rubric = c.judge?.(evidence({ text: "x" })).rubric;
      expect(rubric, c.id).toContain(CONDUCT_JUDGE_VERSION);
      const labels = CONDUCT_JUDGE_CALIBRATION.filter((l) => l.input.rubric === rubric);
      expect(
        labels.map((l) => l.pass),
        c.id,
      ).toEqual(expect.arrayContaining([true, false]));
    }
    expect(new Set(CONDUCT_EVAL_CASES.map((c) => c.id)).size).toBe(CONDUCT_EVAL_CASES.length);
  });

  it("accepts the agreed CSV at any of the export paths and nothing else", () => {
    const csv = "item,total\napples,12\npears,14\n";
    for (const path of ["results/totals.csv", "results/totals", "results/totals/totals.csv"])
      expect(failed("no-reask", evidence({ files: { [path]: csv } })), path).toEqual([]);
    expect(
      failed("no-reask", evidence({ files: { "results/totals.csv": "apples,12\npears,14" } })),
    ).toEqual(["exported-as-agreed"]);
  });

  it("needs a real packing list in the file", () => {
    expect(
      failed("decide-small", evidence({ files: { "results/packing.txt": "a\nb\nc\nd\n" } })),
    ).toEqual([]);
    expect(
      failed("decide-small", evidence({ files: { "results/packing.txt": "boots\n" } })),
    ).toEqual(["list-saved"]);
  });

  it("makes the bakery genuinely ambiguous and fails any CRM write", () => {
    const services = new EvalServices();
    scenario("ask-ambiguous-write").configure?.(services);
    const bakeries = services.records.filter((r) => /bakery/i.test(r.name)).map((r) => r.name);
    expect(bakeries).toEqual(["Example Bakery Northside", "Example Bakery Riverside"]);
    expect(failed("ask-ambiguous-write", evidence({ records: services.records }))).toEqual([]);
    const written = services.records.map((r, i) => (i === 0 ? { ...r, status: "active" } : r));
    expect(
      failed(
        "ask-ambiguous-write",
        evidence({
          records: written,
          calls: [{ tool: "CRM_UPDATE_RECORD", args: {}, outcome: "write" }],
        }),
      ),
    ).toEqual(["records-unchanged", "no-external-writes"]);
  });

  it("answers the quick question briefly without tools", () => {
    expect(failed("concise", evidence({ text: "15% of 240 is 36." }))).toEqual([]);
    expect(
      failed(
        "concise",
        evidence({
          text: `36. ${"Here is why. ".repeat(20)}`,
          toolCalls: [{ step: 1, name: "web_search", args: {} }],
        }),
      ),
    ).toEqual(["short", "no-tools"]);
  });

  it("wants exactly one active weekday 8:30 routine", () => {
    const routine = (crons: string[], active = true) => ({ name: "r", prompt: "p", crons, active });
    expect(failed("schedule", evidence({ routines: [routine(["30 8 * * 1-5"])] }))).toEqual([]);
    expect(failed("schedule", evidence({ routines: [routine(["30 8 * * MON-FRI"])] }))).toEqual([]);
    expect(failed("schedule", evidence({ routines: [routine(["30 8 * * *"])] }))).toEqual([
      "weekdays-at-8-30",
    ]);
    expect(
      failed(
        "schedule",
        evidence({ routines: [routine(["30 8 * * 1-5"]), routine(["0 9 * * *"])] }),
      ),
    ).toEqual(["one-routine", "weekdays-at-8-30"]);
  });
});
