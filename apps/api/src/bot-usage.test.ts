import { describe, expect, it } from "vitest";
import { botUsageRows, cachedShare } from "./bot-usage.js";

const sum = (input: number, output: number, read: number, write = 0) => ({
  inputTokens: input,
  outputTokens: output,
  totalTokens: input + output + read + write,
  cacheReadTokens: read,
  cacheWriteTokens: write,
});

describe("bot usage", () => {
  it("reports the share of prompt tokens served from cache", () => {
    expect(cachedShare(sum(200, 50, 4800))).toBeCloseTo(0.96);
    expect(cachedShare(sum(0, 0, 0))).toBeNull();
  });

  it("joins tokens, first-response medians and names, busiest first", () => {
    const rows = botUsageRows(
      [
        { botId: "small", _count: { _all: 1 }, _sum: sum(10, 5, 0) },
        { botId: "chief", _count: { _all: 9 }, _sum: sum(500, 300, 9000, 200) },
        { botId: null, _count: { _all: 3 }, _sum: sum(1, 1, 1) },
      ],
      [
        { botId: "chief", medianMs: 3247.4, runs: 50 },
        { botId: "quiet", medianMs: 900, runs: 2 },
      ],
      new Map([
        ["chief", { name: "Chief", deleted: false }],
        ["small", { name: "Old helper", deleted: true }],
      ]),
    );
    expect(rows.map((row) => row.botId)).toEqual(["chief", "small", "quiet"]);
    expect(rows[0]).toMatchObject({
      name: "Chief",
      modelCalls: 9,
      totalTokens: 10_000,
      firstResponseMs: 3247,
      firstResponseRuns: 50,
    });
    expect(rows[0]?.cachedShare).toBeCloseTo(9000 / 9700);
    expect(rows[1]).toMatchObject({ name: "Old helper", deleted: true, firstResponseMs: null });
    expect(rows[2]).toMatchObject({
      name: null,
      modelCalls: 0,
      cachedShare: null,
      firstResponseMs: 900,
    });
  });
});
