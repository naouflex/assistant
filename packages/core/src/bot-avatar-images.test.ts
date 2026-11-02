import { isBotAvatarValue } from "@atlas/contracts";
import { describe, expect, it } from "vitest";
import { SHIPPED_BOT_AVATAR_IMAGES, shippedBotAvatarGoggles } from "./bot-avatar-images.js";

describe("shipped bot avatar images", () => {
  it("exposes at least the beach punk portrait as a persistable data URL", () => {
    expect(SHIPPED_BOT_AVATAR_IMAGES.length).toBeGreaterThan(0);
    const punk = SHIPPED_BOT_AVATAR_IMAGES.find((image) => image.id === "beach-punk");
    expect(punk).toBeDefined();
    expect(punk?.value.startsWith("data:image/webp;base64,")).toBe(true);
    expect(isBotAvatarValue(punk!.value)).toBe(true);
    expect(punk?.goggles.startsWith("data:image/webp;base64,")).toBe(true);
    expect(shippedBotAvatarGoggles(punk!.value)).toBe(punk!.goggles);
    expect(shippedBotAvatarGoggles("data:image/png;base64,abc")).toBeUndefined();
  });
});
