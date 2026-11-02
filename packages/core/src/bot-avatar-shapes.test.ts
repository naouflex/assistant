import { BOT_AVATAR_SHAPE_COUNT } from "@atlas/contracts";
import { describe, expect, it } from "vitest";
import {
  SHIPPED_BOT_AVATAR_SHAPE_KEYS,
  SHIPPED_BOT_AVATAR_SHAPES,
  shippedBotAvatarShapePath,
} from "./bot-avatar-shapes.js";

describe("shipped bot avatar shapes", () => {
  it("keeps the same shapes the parser encodes", () => {
    expect(SHIPPED_BOT_AVATAR_SHAPE_KEYS).toHaveLength(BOT_AVATAR_SHAPE_COUNT);
    expect(shippedBotAvatarShapePath(3)).toBe(SHIPPED_BOT_AVATAR_SHAPES.tablet);
    expect(shippedBotAvatarShapePath(3)).not.toBe(shippedBotAvatarShapePath(0));
    expect(shippedBotAvatarShapePath(12)).toBe(SHIPPED_BOT_AVATAR_SHAPES.sun);
    expect(shippedBotAvatarShapePath(22)).toBe(shippedBotAvatarShapePath(0));
    expect(shippedBotAvatarShapePath(11)).toBe(SHIPPED_BOT_AVATAR_SHAPES.gem);
    expect(shippedBotAvatarShapePath(21)).toBe(SHIPPED_BOT_AVATAR_SHAPES.sparkle);
  });

  it("emits path geometry only", () => {
    for (const key of SHIPPED_BOT_AVATAR_SHAPE_KEYS) {
      const path = SHIPPED_BOT_AVATAR_SHAPES[key] ?? "";
      expect(path).toMatch(/^M/);
      expect(path).not.toMatch(/<|>|javascript:|url\(/i);
    }
  });
});
