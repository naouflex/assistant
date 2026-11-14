import { describe, expect, it } from "vitest";
import {
  announcesWorkOnly,
  doneMismatch,
  endsOnAnnouncedWork,
  endsOnSafeOffer,
} from "./done-check.js";

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

describe("endsOnAnnouncedWork", () => {
  const body =
    "The landing crash came from the flare logic: below 30 ft the pitch target jumped. ".repeat(4);
  it("flags a long reply that ends on the next step", () => {
    expect(
      endsOnAnnouncedWork(`${body}\n\nNext I'll re-check the log and then launch the flight.`),
    ).toBe(true);
    expect(
      endsOnAnnouncedWork(`${body}\n\nTests pass. I'll now sync to Windows and relaunch.`),
    ).toBe(true);
    expect(
      endsOnAnnouncedWork(`${body}\n\nJe vais relancer le vol et vérifier l'atterrissage.`),
    ).toBe(true);
  });
  it("leaves replies that wait on the owner, ask, or are short", () => {
    expect(endsOnAnnouncedWork(`${body}\n\nOnce you say go, I'll launch the flight.`)).toBe(false);
    expect(endsOnAnnouncedWork(`${body}\n\nI'll deploy if you confirm.`)).toBe(false);
    expect(endsOnAnnouncedWork(`${body}\n\nShould I launch the flight?`)).toBe(false);
    expect(endsOnAnnouncedWork(`${body}\n\nThe fix is committed and the flight landed.`)).toBe(
      false,
    );
    expect(endsOnAnnouncedWork("Next I'll launch the flight.")).toBe(false);
  });
});

describe("endsOnSafeOffer", () => {
  const body = "I checked the logs and the controller stopped at 14:02.";
  it("catches offers of a retry, a check or a search", () => {
    expect(
      endsOnSafeOffer(`${body}\n\nTell me to retry, and I'll check live prices in the browser.`),
    ).toBe(true);
    expect(
      endsOnSafeOffer(
        `${body}\n\nIf you want me to read the logs through razer now, say so and I'll try it once.`,
      ),
    ).toBe(true);
    expect(endsOnSafeOffer(`${body}\n\nDis-moi si je dois vérifier les logs.`)).toBe(true);
    expect(
      endsOnSafeOffer(
        `${body}\n\nI could try the same check through your own computer instead. Say if you want that.`,
      ),
    ).toBe(true);
    expect(
      endsOnSafeOffer(
        `${body}\n\nI can open Google News on your PC or on mine. Tell me which one and I'll do it.`,
      ),
    ).toBe(true);
  });
  it("keeps asks for steps that change, send or restart something", () => {
    expect(
      endsOnSafeOffer(`${body}\n\nSay go and I'll restart the controller and check the log.`),
    ).toBe(false);
    expect(endsOnSafeOffer(`${body}\n\nWant me to send it to Sam?`)).toBe(false);
    expect(endsOnSafeOffer(`${body}\n\nShould I deploy it now?`)).toBe(false);
  });
  it("ignores replies that end on a result", () => {
    expect(endsOnSafeOffer(`${body}\n\nThe fix is committed and the tests pass.`)).toBe(false);
  });
});
