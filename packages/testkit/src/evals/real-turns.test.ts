import { describe, expect, it } from "vitest";
import {
  isCleanTurn,
  parseRealTurnVerdict,
  REAL_TURN_CALIBRATION,
  REAL_TURN_ISSUES,
  REAL_TURN_RUBRIC,
  REAL_TURN_RUBRIC_VERSION,
  realTurnPrompt,
  scrubTurnText,
  summarizeRealTurns,
} from "./real-turns.js";

describe("real-turn review", () => {
  it("versions the rubric and names every issue in it", () => {
    expect(REAL_TURN_RUBRIC).toContain(REAL_TURN_RUBRIC_VERSION);
    for (const issue of REAL_TURN_ISSUES) expect(REAL_TURN_RUBRIC).toContain(`- ${issue}:`);
  });

  it("parses a fenced verdict and drops duplicate issues", () => {
    const verdict = parseRealTurnVerdict(
      'Here:\n```json\n{"reason":"Claimed success after a failed deploy {sic}","completion":"failed","issues":["hallucination","hallucination"],"severity":3}\n```',
    );
    expect(verdict).toEqual({
      reason: "Claimed success after a failed deploy {sic}",
      completion: "failed",
      issues: ["hallucination"],
      severity: 3,
    });
  });

  it.each([
    '{"reason":"x","completion":"done","issues":["rude"],"severity":1}',
    '{"reason":"x","completion":"finished","issues":[],"severity":0}',
    '{"reason":"","completion":"done","issues":[],"severity":0}',
    '{"reason":"x","completion":"done","issues":[],"severity":5}',
    "no verdict",
  ])("fails closed on %s", (text) => {
    expect(() => parseRealTurnVerdict(text)).toThrow("Invalid real-turn verdict");
  });

  it("scrubs credentials and contact details before a turn leaves the machine", () => {
    const text = [
      "token xoxb-1234-abcd",
      "key AKIAABCDEFGHIJKLMNOP",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "mail me at someone@example.com or +33 6 12 34 56 78",
      "session Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb7cDe0fGh3",
      "password=hunter2",
    ].join("\n");
    const safe = scrubTurnText(text);
    for (const leak of [
      "xoxb-1234",
      "AKIAABCD",
      "eyJhbGci",
      "someone@example.com",
      "12 34 56",
      "Ab3dEf6h",
      "hunter2",
    ])
      expect(safe).not.toContain(leak);
    expect(scrubTurnText("Meeting at 2026-11-14 10:45 in packages/adapters/src")).toBe(
      "Meeting at 2026-11-14 10:45 in packages/adapters/src",
    );
  });

  it("puts only scrubbed evidence in the judge prompt", () => {
    const prompt = realTurnPrompt({
      ...REAL_TURN_CALIBRATION[0]!.turn,
      user: "use sk-live-abcdef123456 please",
    });
    expect(prompt).not.toContain("sk-live-abcdef123456");
    expect(JSON.parse(prompt)).toMatchObject({ rubric: REAL_TURN_RUBRIC });
  });

  it("counts issues, severe turns and clean turns per bot", () => {
    const summary = summarizeRealTurns([
      {
        turn: { bot: "A" },
        verdict: { reason: "ok", completion: "done", issues: [], severity: 0 },
      },
      {
        turn: { bot: "A" },
        verdict: {
          reason: "r",
          completion: "partial",
          issues: ["stalled", "verbose"],
          severity: 2,
        },
      },
      {
        turn: { bot: "B" },
        verdict: { reason: "r", completion: "done", issues: ["verbose"], severity: 1 },
      },
    ]);
    expect(summary.clean).toBe(2);
    expect(summary.issues).toEqual([
      { issue: "verbose", turns: 2, severe: 1 },
      { issue: "stalled", turns: 1, severe: 1 },
    ]);
    expect(summary.byBot).toEqual([
      { bot: "A", graded: 2, clean: 1 },
      { bot: "B", graded: 1, clean: 1 },
    ]);
    expect(summary.completion.partial).toBe(1);
  });

  it("calibrates on a clean anchor and on every issue but the catch-all incomplete", () => {
    expect(REAL_TURN_CALIBRATION.some((anchor) => anchor.clean)).toBe(true);
    const labelled = new Set(REAL_TURN_CALIBRATION.flatMap((anchor) => anchor.issues));
    expect(REAL_TURN_ISSUES.filter((issue) => !labelled.has(issue))).toEqual(["incomplete"]);
    expect(isCleanTurn({ reason: "r", completion: "partial", issues: [], severity: 0 })).toBe(
      false,
    );
  });
});
