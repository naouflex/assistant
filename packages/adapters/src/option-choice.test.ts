import { describe, expect, it } from "vitest";
import { OPTION_CHOICE_NOTE, optionChoiceNote, wantsOptionChoice } from "./option-choice.js";

describe("option choice note", () => {
  it.each([
    "Help me pick a dinner for tonight: should I cook pasta, order sushi, or have a salad? Let me choose.",
    "I want to plan my Sunday. Give me a few options to pick from.",
    "Show me three options for the logo",
    "What option should I go with? Give me choices",
    "Propose-moi des options pour ce soir",
    "Laisse-moi choisir le restaurant",
  ])("asks for option cards on %j", (text) => {
    expect(wantsOptionChoice(text)).toBe(true);
    expect(optionChoiceNote(text, { askUserOffered: true })).toBe(OPTION_CHOICE_NOTE);
  });

  it.each([
    "What is the capital of France?",
    "Should I use Postgres or SQLite for this?",
    "List the options of the ls command",
    "",
  ])("leaves %j alone", (text) => {
    expect(optionChoiceNote(text, { askUserOffered: true })).toBeUndefined();
  });

  it("stays off without ask_user and on voice calls", () => {
    const text = "Let me choose between tea and coffee";
    expect(optionChoiceNote(text, { askUserOffered: false })).toBeUndefined();
    expect(optionChoiceNote(text, { askUserOffered: true, voiceCall: true })).toBeUndefined();
  });
});
