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
});
