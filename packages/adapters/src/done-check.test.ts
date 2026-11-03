import { describe, expect, it } from "vitest";
import { doneMismatch } from "./done-check.js";

describe("doneMismatch", () => {
  it("nudges once-worthy text when a tool failed and the reply claims success", () => {
    const nudge = doneMismatch("Done — I saved the file.", [
      { name: "write_file", ok: false, error: "permission denied" },
    ]);
    expect(nudge).toContain("write_file");
    expect(nudge).toContain("permission denied");
  });

  it("stays quiet when the reply already admits the failure", () => {
    expect(
      doneMismatch("I couldn't save it: permission denied.", [
        { name: "write_file", ok: false, error: "permission denied" },
      ]),
    ).toBeUndefined();
  });

  it("treats a later success as clearing that tool's earlier failure", () => {
    expect(
      doneMismatch("Done — I saved the file.", [
        { name: "write_file", ok: false, error: "permission denied" },
        { name: "write_file", ok: true },
      ]),
    ).toBeUndefined();
  });

  it("keeps a failure on one file when a later call succeeds on another", () => {
    const nudge = doneMismatch("Done — I saved both files.", [
      { name: "write_file", target: "a.txt", ok: false, error: "permission denied" },
      { name: "write_file", target: "b.txt", ok: true },
    ]);
    expect(nudge).toContain("a.txt");
    expect(nudge).toContain("permission denied");
  });

  it("understands a French success claim", () => {
    const nudge = doneMismatch("C'est fait, j'ai enregistré le fichier.", [
      { name: "write_file", ok: false, error: "permission denied" },
    ]);
    expect(nudge).toContain("write_file");
  });

  it("stays quiet when every tool succeeded", () => {
    expect(doneMismatch("Done — I saved the file.", [{ name: "write_file", ok: true }])).toBeUndefined();
  });
});
