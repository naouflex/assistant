import { describe, expect, it } from "vitest";
import { parseDreamProposals } from "./memory-dream.js";

const allowed = {
  scope: "bot" as const,
  botId: "bot-1",
  runIds: new Set(["run-1", "run-2"]),
};

describe("parseDreamProposals", () => {
  it("keeps a proposal that cites a run from the pack", () => {
    const parsed = parseDreamProposals(
      JSON.stringify({
        proposals: [
          {
            scope: "bot",
            path: "MEMORY.md",
            content: "Invoices go to finance.",
            reason: "The last two runs both said so.",
            runIds: ["run-1", "missing"],
            count: 4,
          },
        ],
      }),
      allowed,
    );
    expect(parsed).toEqual({
      proposals: [
        {
          scope: "bot",
          path: "MEMORY.md",
          content: "Invoices go to finance.",
          reason: "The last two runs both said so.",
          runIds: ["run-1"],
          count: 1,
        },
      ],
    });
  });

  it("reads a single json fence", () => {
    const parsed = parseDreamProposals('```json\n{"proposals":[]}\n```', allowed);
    expect(parsed).toEqual({ proposals: [] });
  });

  it("drops a proposal for the other scope or an unknown run", () => {
    const parsed = parseDreamProposals(
      JSON.stringify({
        proposals: [
          {
            scope: "user",
            path: "MEMORY.md",
            content: "Shared",
            reason: "Wrong scope",
            runIds: ["run-1"],
          },
          {
            scope: "bot",
            path: "MEMORY.md",
            content: "Guess",
            reason: "No evidence",
            runIds: ["run-9"],
          },
        ],
      }),
      allowed,
    );
    expect(parsed).toEqual({ proposals: [] });
  });

  it("rejects text that is not proposals", () => {
    expect(parseDreamProposals("not json", allowed)).toEqual({
      error: "The review did not return JSON.",
    });
    expect(parseDreamProposals("{}", allowed)).toEqual({
      error: "The review did not return proposals.",
    });
  });
});
