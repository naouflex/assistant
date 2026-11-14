import { describe, expect, it } from "vitest";
import { announcesWorkOnly, doneMismatch } from "./done-check.js";

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
    expect(
      doneMismatch("Done — I saved the file.", [{ name: "write_file", ok: true }]),
    ).toBeUndefined();
  });
});

describe("announced work", () => {
  it("catches a reply that only promises work", () => {
    for (const reply of [
      "On it",
      "Let me check the logs.",
      "Okay, I'll look into the landing issue now.",
      "I'm checking the server.",
      "Je regarde ça.",
      "Give me a minute.",
    ])
      expect(announcesWorkOnly(reply), reply).toBe(true);
  });

  it("leaves results, questions and promises the system keeps alone", () => {
    for (const reply of [
      "I'll remind you at 8:00.",
      "Done: the build passes.",
      "Let me know if you want the long version.",
      "Should I deploy it to staging?",
      "",
      `Let me explain. ${"The logs show three restarts. ".repeat(10)}`,
    ])
      expect(announcesWorkOnly(reply), reply).toBe(false);
  });
});
