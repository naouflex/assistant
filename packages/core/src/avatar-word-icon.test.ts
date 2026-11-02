import { describe, expect, it } from "vitest";
import { avatarWordIcon } from "./avatar-word-icon.js";

describe("word pictures", () => {
  it("draws an anchor for the word anchor", () => {
    const anchor = avatarWordIcon("anchor");
    const again = avatarWordIcon("An anchor");
    expect(anchor).toEqual(again);
    expect(anchor?.some((node) => node[0] === "path" && node[1].includes("M12 6v16"))).toBe(true);
    expect(avatarWordIcon("anchors")).toEqual(anchor);
  });

  it("leaves an unknown word without a picture", () => {
    expect(avatarWordIcon("river")).toBeNull();
    expect(avatarWordIcon("not-a-thing")).toBeNull();
  });
});
