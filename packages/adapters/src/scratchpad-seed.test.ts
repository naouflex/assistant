import { describe, expect, it } from "vitest";
import { parseScratchpadSeeds } from "./scratchpad-seed.js";

describe("parseScratchpadSeeds", () => {
  it("parses numbered and bulleted lists", () => {
    expect(
      parseScratchpadSeeds("1. Ship memory search\n2. Tune compaction\n- Fix ack timing"),
    ).toEqual(["Ship memory search", "Tune compaction", "Fix ack timing"]);
  });

  it("ignores single-item lists", () => {
    expect(parseScratchpadSeeds("1. Only one thing")).toEqual([]);
  });

  it("parses French task lists", () => {
    expect(parseScratchpadSeeds("1. Corriger le journal\n2. Ajouter le fuseau")).toEqual([
      "Corriger le journal",
      "Ajouter le fuseau",
    ]);
  });

  it("ignores bullets that read like a log rather than tasks", () => {
    expect(
      parseScratchpadSeeds(
        "- Error: ENOENT at /tmp/file\n- at Function.execute (index.js:10)\n- failed to read the socket",
      ),
    ).toEqual([]);
  });
});
