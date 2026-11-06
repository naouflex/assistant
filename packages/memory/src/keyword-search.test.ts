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

  it("matches terms as whole words, not inside longer words", () => {
    expect(memorySearchTermHits("catalyst", "x.md", ["atlas"])).toBe(0);
    expect(memorySearchTermHits("atlas-rebrand is live", "x.md", ["atlas"])).toBe(1);
    expect(memorySearchTermHits("Atlases plural", "x.md", ["atlas"])).toBe(0);
  });

  it("snippets around a matching term", () => {
    const snippet = memorySearchSnippet("prefix needle suffix", ["needle"]);
    expect(snippet).toContain("needle");
  });

  it("centers the snippet on the densest cluster of term hits", () => {
    const filler = "x ".repeat(120);
    const content = "needle early. " + filler + "needle needle needle together";
    const snippet = memorySearchSnippet(content, ["needle"]);
    expect(snippet).toContain("needle needle needle");
    expect(snippet).not.toContain("needle early");
  });
});
