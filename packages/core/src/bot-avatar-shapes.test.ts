import { BOT_AVATAR_SHAPE_COUNT } from "@atlas/contracts";
import { describe, expect, it } from "vitest";
import {
  SHIPPED_BOT_AVATAR_SHAPE_FACE,
  SHIPPED_BOT_AVATAR_SHAPE_KEYS,
  SHIPPED_BOT_AVATAR_SHAPES,
  shippedBotAvatarShapeFace,
  shippedBotAvatarShapeInkY,
  shippedBotAvatarShapePath,
} from "./bot-avatar-shapes.js";

describe("shipped bot avatar shapes", () => {
  it("keeps the same shapes the parser encodes", () => {
    expect(SHIPPED_BOT_AVATAR_SHAPE_KEYS).toHaveLength(BOT_AVATAR_SHAPE_COUNT);
    expect(shippedBotAvatarShapePath(3)).toBe(SHIPPED_BOT_AVATAR_SHAPES.tablet);
    expect(shippedBotAvatarShapePath(3)).not.toBe(shippedBotAvatarShapePath(0));
    expect(shippedBotAvatarShapePath(14)).toBe(SHIPPED_BOT_AVATAR_SHAPES.sun);
    expect(shippedBotAvatarShapePath(24)).toBe(shippedBotAvatarShapePath(0));
    expect(shippedBotAvatarShapePath(11)).toBe(SHIPPED_BOT_AVATAR_SHAPES.gem);
    expect(shippedBotAvatarShapePath(23)).toBe(SHIPPED_BOT_AVATAR_SHAPES.sparkle);
    expect(shippedBotAvatarShapeFace(12).eyeCenterY).toBe(
      SHIPPED_BOT_AVATAR_SHAPE_FACE.penis!.eyeCenterY,
    );
    expect(shippedBotAvatarShapeInkY(18)).toBe(SHIPPED_BOT_AVATAR_SHAPE_FACE.crown!.inkY);
  });

  it("emits path geometry only", () => {
    for (const key of SHIPPED_BOT_AVATAR_SHAPE_KEYS) {
      const path = SHIPPED_BOT_AVATAR_SHAPES[key] ?? "";
      expect(path).toMatch(/^M/);
      expect(path).not.toMatch(/<|>|javascript:|url\(/i);
    }
  });
});
