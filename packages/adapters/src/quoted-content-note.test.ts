import { describe, expect, it } from "vitest";
import {
  isReadBackRequest,
  QUOTED_CONTENT_NOTE,
  quotedContentNote,
} from "./quoted-content-note.js";

describe("quotedContentNote", () => {
  it("adds the note when asked to summarize or read back content", () => {
    for (const text of [
      "Find the quoted Aurora historical document and summarize its content.",
      "Can you give me a tl;dr of this email?",
      "What does the document say about pricing?",
      "Here is the pasted email from the vendor, what should I answer?",
      "Peux-tu résumer ce document ?",
    ]) {
      expect(isReadBackRequest(text), text).toBe(true);
    }
    expect(quotedContentNote("Summarize this page")).toBe(QUOTED_CONTENT_NOTE);
  });

  it("stays out of ordinary requests and voice calls", () => {
    for (const text of [
      "Book a table for two at 8",
      "What is the weather tomorrow?",
      "Remind me at 9",
    ]) {
      expect(isReadBackRequest(text), text).toBe(false);
    }
    expect(quotedContentNote("Summarize this page", { voiceCall: true })).toBeUndefined();
    expect(quotedContentNote(undefined)).toBeUndefined();
  });
});
