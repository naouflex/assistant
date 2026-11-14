import { describe, expect, it } from "vitest";
import { isRecallQuestion, RECALL_NOTE, recallNote } from "./recall-question.js";

describe("recall questions", () => {
  it.each([
    "What calibration label did we choose for Aurora?",
    "Do you remember the identifier for our Aurora data extraction effort?",
    "What was that Aurora calibration label again?",
    "What was the password for Aurora?",
    "Remind me of the Aurora batch size.",
    "Qu'est-ce qu'on avait choisi comme thème ?",
    "Rappelle-moi la taille du lot.",
  ])("notices %s", (text) => {
    expect(isRecallQuestion(text)).toBe(true);
    expect(recallNote(text)).toBe(RECALL_NOTE);
  });

  it.each([
    "Quick one: what's 15% of 240?",
    "Write a packing list and save it to results/packing.txt.",
    "Remind me every weekday at 8:30 to check the dashboard.",
    "Rappelle-moi de payer le loyer demain.",
    "",
  ])("leaves %s alone", (text) => {
    expect(recallNote(text)).toBeUndefined();
  });

  it("stays off voice calls", () => {
    expect(recallNote("What did we decide?", { voiceCall: true })).toBeUndefined();
  });
});
