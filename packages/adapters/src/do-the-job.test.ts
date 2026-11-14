import { describe, expect, it } from "vitest";
import { DO_THE_JOB_NOTE, asksToDoTheJob, doTheJobNote } from "./do-the-job.js";

const offered = { toolsOffered: true };

describe("do the job note", () => {
  it.each([
    "you do it",
    "run the code and show me the svg",
    "i see the code not the logo",
    "Show me a blue circle as an SVG in this chat.",
    "On your computer, create workspace/chief/ping.txt containing exactly pong.",
    "Run date in the terminal and tell me the timezone.",
    "fix it",
    "fais-le",
  ])("asks for the file on %j", (text) => {
    expect(asksToDoTheJob(text)).toBe(true);
    expect(doTheJobNote(text, offered)).toBe(DO_THE_JOB_NOTE);
  });

  it.each(["What is the capital of France?", "Show me three options for dinner", ""])(
    "leaves %j alone",
    (text) => {
      expect(doTheJobNote(text, offered)).toBeUndefined();
    },
  );

  it("stays off without the file tools and on voice calls", () => {
    const text = "Show me the svg";
    expect(doTheJobNote(text, { toolsOffered: false })).toBeUndefined();
    expect(doTheJobNote(text, { toolsOffered: true, voiceCall: true })).toBeUndefined();
  });
});
