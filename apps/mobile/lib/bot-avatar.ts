import type { ParsedBotAvatar } from "@atlas/contracts";
import { parseBotAvatarValue } from "@atlas/contracts";
import {
  avatarWordShapePath,
  resolvePersonaColorDef,
  shippedBotAvatarShapePath,
} from "@atlas/core";

export type MobileBotAvatarPresentation =
  | Exclude<ParsedBotAvatar, { kind: "shape" | "word" }>
  | { kind: "shape"; color: string; shapeIndex: number; shapePath: string; eyeColor: string }
  | { kind: "word"; color: string; word: string; shapePath: string };

/** Resolve a stored `bots.color` value for native rendering, including shape paths. */
export function mobileBotAvatarPresentation(color: string): MobileBotAvatarPresentation {
  const parsed = parseBotAvatarValue(color);
  if (parsed.kind === "word") {
    return { ...parsed, shapePath: avatarWordShapePath(parsed.word) };
  }
  if (parsed.kind !== "shape") return parsed;
  return {
    ...parsed,
    shapePath: shippedBotAvatarShapePath(parsed.shapeIndex),
    eyeColor: resolvePersonaColorDef("preview", parsed.color).eyeColor,
  };
}
