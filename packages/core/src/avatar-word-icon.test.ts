import { describe, expect, it } from "vitest";
import { avatarWordIcon, avatarWordInk, avatarWordLetter } from "./avatar-word-icon.js";

describe("word pictures", () => {
  it("draws an anchor for the word anchor", () => {
    const anchor = avatarWordIcon("anchor");
    const again = avatarWordIcon("An anchor");
    expect(anchor).toEqual(again);
    expect(anchor?.some((node) => node[0] === "path" && node[1].includes("M12 6v16"))).toBe(true);
    expect(avatarWordIcon("anchors")).toEqual(anchor);
  });

  it("leaves an unknown word, and a phrase, without a picture", () => {
    expect(avatarWordIcon("river")).toBeNull();
    expect(avatarWordIcon("not-a-thing")).toBeNull();
    expect(avatarWordIcon("cat")).not.toBeNull();
    expect(avatarWordIcon("cat food")).toBeNull();
  });

  it("picks ink and a letter that stay the same for the same word", () => {
    expect(avatarWordInk("#FFFFFF")).toBe("#141414");
    expect(avatarWordInk("#141414")).toBe("#FFFFFF");
    expect(avatarWordLetter("river")).toBe("R");
    expect(avatarWordLetter("étoile")).toBe("É");
  });
});
