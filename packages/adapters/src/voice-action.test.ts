import { describe, expect, it } from "vitest";
import { VOICE_ACTION_NOTE, voiceActionNote } from "./voice-action.js";

describe("voice action note", () => {
  it.each([
    "Look up who won the Tour de France most recently.",
    "Remind me tomorrow at 9 to call Alex.",
    "Remember that I prefer short answers.",
    "Run date in the terminal.",
    "Do it for me.",
    "What's on my calendar tomorrow?",
  ])("nudges tools on %j", (text) => {
    expect(voiceActionNote(text, { voiceCall: true })).toBe(VOICE_ACTION_NOTE);
  });

  it.each(["Thanks.", "Hello.", ""])("leaves casual chat alone on %j", (text) => {
    expect(voiceActionNote(text, { voiceCall: true })).toBeUndefined();
  });

  it("stays off outside voice calls", () => {
    expect(voiceActionNote("Look that up.", { voiceCall: false })).toBeUndefined();
  });
});
