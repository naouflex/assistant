import { describe, expect, it } from "vitest";
import { localAnswerThinking, needsLookupOrPlan, needsWebLookup } from "./answer-quality.js";

describe("local answer thinking", () => {
  it.each([
    "Search the web for the latest Node.js release.",
    "Who is Ada Lovelace?",
    "What did we decide last time?",
    "Remind me where the invoices go.",
    "Plan how we should ship this.",
    "Cherche le statut de la commande.",
    "What files are in the home folder?",
  ])("thinks for a lookup or a plan: %s", (text) => {
    expect(needsLookupOrPlan(text)).toBe(true);
    expect(localAnswerThinking({ provider: "local", explicit: null, text })).toBe("low");
  });

  it.each(["What's your name again?", "Run python3 -c 'print(6*7)'.", "Thanks."])(
    "stays off for a direct reply: %s",
    (text) => {
      expect(needsLookupOrPlan(text)).toBe(false);
      expect(localAnswerThinking({ provider: "local", explicit: null, text })).toBe("off");
    },
  );

  it("keeps a saved thinking level", () => {
    expect(
      localAnswerThinking({
        provider: "local",
        explicit: "high",
        text: "What's your name again?",
      }),
    ).toBe("high");
    expect(
      localAnswerThinking({
        provider: "local",
        explicit: "off",
        text: "Search the web for the latest release.",
      }),
    ).toBe("off");
  });

  it.each(["Who is Ada Lovelace?", "Search the web for the latest Node.js release."])(
    "needs a web search: %s",
    (text) => {
      expect(needsWebLookup(text)).toBe(true);
    },
  );

  it.each([
    "What's your name again?",
    "Who is my dentist?",
    "Thanks.",
    "What files are in the home folder?",
  ])("does not force a web search: %s", (text) => {
    expect(needsWebLookup(text)).toBe(false);
  });

  it("leaves a hosted model's level alone", () => {
    expect(
      localAnswerThinking({ provider: "openrouter", explicit: null, text: "Search the web." }),
    ).toBeNull();
  });
});
