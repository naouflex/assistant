import { describe, expect, it } from "vitest";
import {
  ROUTINE_SILENCE_NOTE,
  routineAsksForSilence,
  routineSilenceNote,
} from "./routine-silence-note.js";

describe("routineSilenceNote", () => {
  it("adds the note when the routine prompt asks for silence", () => {
    for (const prompt of [
      "Check releases. If there is nothing new, stay silent.",
      "Look at my inbox and only notify me about invoices.",
      "Don't message me if nothing changed.",
      "Vérifie le site et reste silencieux s'il n'y a rien.",
    ]) {
      expect(routineAsksForSilence(prompt), prompt).toBe(true);
    }
    expect(routineSilenceNote("Stay quiet unless the build broke.")).toBe(ROUTINE_SILENCE_NOTE);
    expect(ROUTINE_SILENCE_NOTE).toContain("NO_RESPONSE");
  });

  it("stays out of routines that always report", () => {
    for (const prompt of [
      "Send me a morning briefing with the weather.",
      "Summarize yesterday's sales.",
    ]) {
      expect(routineAsksForSilence(prompt), prompt).toBe(false);
    }
    expect(routineSilenceNote(undefined)).toBeUndefined();
  });
});
