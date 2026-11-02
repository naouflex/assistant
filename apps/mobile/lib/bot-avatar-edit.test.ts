import { botAvatarWordValue } from "@atlas/contracts";
import { describe, expect, it } from "vitest";
import {
  avatarColor,
  avatarShape,
  avatarWord,
  isAvatarPhoto,
  withAvatarColor,
  withAvatarShape,
  withAvatarWord,
} from "./bot-avatar-edit";

describe("bot avatar editing", () => {
  it("keeps the shape when the color changes", () => {
    expect(withAvatarColor("#3EC5A8::shape_3", "#F5A03C")).toBe("#F5A03C::shape_3");
    expect(withAvatarColor("#3EC5A8", "#F5A03C")).toBe("#F5A03C");
  });

  it("keeps the color when the shape changes", () => {
    expect(withAvatarShape("#F5A03C", 5)).toBe("#F5A03C::shape_5");
    expect(avatarShape("#F5A03C::shape_5")).toBe(5);
    expect(avatarColor("#F5A03C::shape_5")).toBe("#F5A03C");
  });

  it("keeps a generated word when the color changes and drops it for a shipped shape", () => {
    const river = botAvatarWordValue("#3EC5A8", "river")!;
    expect(withAvatarColor(river, "#F5A03C")).toBe(botAvatarWordValue("#F5A03C", "river"));
    expect(avatarWord(river)).toBe("river");
    expect(avatarColor(river)).toBe("#3EC5A8");
    expect(withAvatarWord("#F5A03C::shape_2", "oak")).toBe(botAvatarWordValue("#F5A03C", "oak"));
    expect(avatarShape(withAvatarShape(river, 1))).toBe(1);
    expect(avatarWord(withAvatarShape(river, 1))).toBeNull();
  });

  it("replaces a photo with a plain color", () => {
    const photo = "data:image/webp;base64,AAAA";
    expect(isAvatarPhoto(photo)).toBe(true);
    expect(isAvatarPhoto(avatarColor(photo))).toBe(false);
    expect(withAvatarColor(photo, "#6A6BF5")).toBe("#6A6BF5");
    expect(avatarShape(photo)).toBeNull();
  });
});
