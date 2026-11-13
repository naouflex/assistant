import { describe, expect, it } from "vitest";
import { dreamError, parseDreamProposals } from "./memory-dream.js";
import type { DreamRailInput } from "./memory-dream-rails.js";
import {
  applyDreamEdits,
  decideDreamRail,
  lineChanges,
  looksLikeSecret,
  parseDreamEdits,
  redactSecrets,
} from "./memory-dream-rails.js";

const note = [
  "# Notes",
  "Deploys run from razer.",
  "Invoices go to Bob. [pin]",
  "Model is free.",
].join("\n");

function rail(overrides: Partial<DreamRailInput> = {}): DreamRailInput {
  return {
    scope: "bot",
    patch: true,
    noteExists: true,
    previous: note,
    next: `${note}\nNew fact.\n`,
    added: ["New fact."],
    removed: [],
    pinnedTouched: false,
    limitChars: 4096,
    autoAppliesInWindow: 0,
    autoApplyEnabled: true,
    ...overrides,
  };
}

describe("applyDreamEdits", () => {
  it("applies to the note as it is now", () => {
    const applied = applyDreamEdits(note, [
      { op: "replace", find: "Model is free.", text: "Model is openrouter/free." },
      { op: "add", text: "Calls are on." },
    ]);
    expect(applied).toEqual({
      ok: true,
      content:
        "# Notes\nDeploys run from razer.\nInvoices go to Bob. [pin]\nModel is openrouter/free.\nCalls are on.\n",
      added: ["Model is openrouter/free.", "Calls are on."],
      removed: ["Model is free."],
      pinnedTouched: false,
    });
  });

  it("refuses when the target line is gone or ambiguous", () => {
    expect(applyDreamEdits(note, [{ op: "remove", find: "Gone." }]).ok).toBe(false);
    expect(applyDreamEdits("a\na", [{ op: "remove", find: "a" }]).ok).toBe(false);
  });

  it("flags a pinned line", () => {
    const applied = applyDreamEdits(note, [{ op: "remove", find: "Invoices go to Bob. [pin]" }]);
    expect(applied.ok && applied.pinnedTouched).toBe(true);
  });
});

describe("decideDreamRail", () => {
  it("applies a small patch to a bot's own note", () => {
    expect(decideDreamRail(rail())).toEqual({ mode: "auto" });
  });

  it("asks for shared memory, rewrites, new notes, pins, big removals and the daily cap", () => {
    expect(decideDreamRail(rail({ scope: "user" })).mode).toBe("ask");
    expect(decideDreamRail(rail({ patch: false })).mode).toBe("ask");
    expect(decideDreamRail(rail({ noteExists: false })).mode).toBe("ask");
    expect(decideDreamRail(rail({ pinnedTouched: true })).mode).toBe("ask");
    expect(decideDreamRail(rail({ removed: ["a", "b"] })).mode).toBe("ask");
    expect(decideDreamRail(rail({ autoAppliesInWindow: 1 })).mode).toBe("ask");
    expect(decideDreamRail(rail({ autoApplyEnabled: false })).mode).toBe("ask");
  });

  it("drops anything that looks like a credential or does not fit", () => {
    const key = "sk-abcdefghijklmnopqrstuvwxyz123456";
    expect(decideDreamRail(rail({ added: [`Key ${key}`], next: key })).mode).toBe("drop");
    expect(decideDreamRail(rail({ limitChars: 10 })).mode).toBe("drop");
  });

  it("drops growth past the byte cap but lets an oversized note shrink", () => {
    const grow = rail({ limitBytes: 10, previous: "short", next: "a much longer note" });
    expect(decideDreamRail(grow)).toEqual({
      mode: "drop",
      why: "It would push the note past its size cap.",
    });
    // Multi-byte text counts in bytes, as the prompt cap does.
    expect(decideDreamRail(rail({ limitBytes: 4, previous: "", next: "ééé" })).mode).toBe("drop");
    const shrink = rail({ limitBytes: 10, previous: "x".repeat(40), next: "x".repeat(30) });
    expect(decideDreamRail(shrink).mode).not.toBe("drop");
    expect(decideDreamRail(rail({ limitBytes: 4096 }))).toEqual({ mode: "auto" });
  });
});

describe("secrets", () => {
  it("spots and masks credentials", () => {
    expect(looksLikeSecret("password: hunter22")).toBe(true);
    expect(looksLikeSecret("https://user:pw@example.com/x")).toBe(true);
    expect(looksLikeSecret("Deploy with deploy-apps-prod.sh")).toBe(false);
    expect(redactSecrets("token=abcdef123456 and more")).toBe("[redacted] and more");
  });

  it("stores the real cause of a failed review, masked", () => {
    expect(dreamError("openrouter/free: 429 rate limited")).toBe(
      "Could not review recent runs: openrouter/free: 429 rate limited",
    );
    expect(dreamError("bad key sk-abcdefghijklmnopqrstuvwxyz")).toBe(
      "Could not review recent runs: bad key [redacted]",
    );
    expect(dreamError("  ")).toBe("Could not review recent runs.");
  });
});

describe("parse", () => {
  it("reads line edits and rejects malformed ones", () => {
    expect(parseDreamEdits([{ op: "add", text: "x" }])).toEqual([{ op: "add", text: "x" }]);
    expect(parseDreamEdits([{ op: "replace", find: "x" }])).toBeNull();
    expect(parseDreamEdits([])).toBeNull();
  });

  it("keeps a proposal made of edits", () => {
    const parsed = parseDreamProposals(
      JSON.stringify({
        proposals: [
          {
            scope: "bot",
            path: "MEMORY.md",
            edits: [{ op: "add", text: "Calls are on." }],
            reason: "Two runs used calls.",
            runIds: ["run-1"],
          },
        ],
      }),
      { scope: "bot", botId: "bot-1", runIds: new Set(["run-1"]) },
    );
    expect(parsed).toEqual({
      proposals: [
        {
          scope: "bot",
          path: "MEMORY.md",
          edits: [{ op: "add", text: "Calls are on." }],
          reason: "Two runs used calls.",
          runIds: ["run-1"],
          count: 1,
        },
      ],
    });
  });

  it("lists line changes of a full rewrite", () => {
    expect(lineChanges("a\nb", "a\nc")).toEqual({ added: ["c"], removed: ["b"] });
  });
});
