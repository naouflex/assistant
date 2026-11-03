import { describe, expect, it } from "vitest";
import {
  memorySearchSnippet,
  memorySearchTermHits,
  memorySearchTerms,
} from "./keyword-search.js";

describe("memory keyword search", () => {
  it("tokenizes and dedupes terms", () => {
    expect(memorySearchTerms("Hello hello world")).toEqual(["hello", "world"]);
  });

  it("scores by how many terms hit", () => {
    expect(memorySearchTermHits("alpha beta", "notes/alpha.md", ["alpha", "gamma"])).toBe(1);
    expect(memorySearchTermHits("alpha beta gamma", "x.md", ["alpha", "gamma"])).toBe(2);
  });

  it("snippets around the first matching term", () => {
    const snippet = memorySearchSnippet("prefix needle suffix", ["needle"]);
    expect(snippet).toContain("needle");
  });
});
