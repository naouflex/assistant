import type { ParsedBotAvatar } from "@atlas/contracts";
import { parseBotAvatarValue } from "@atlas/contracts";
import type { AvatarWordIconNode } from "@atlas/core";
import {
  avatarWordIcon,
  avatarWordShapePath,
  resolvePersonaColorDef,
  shippedBotAvatarShapePath,
} from "@atlas/core";

export type MobileBotAvatarPresentation =
  | Exclude<ParsedBotAvatar, { kind: "shape" | "word" }>
  | { kind: "shape"; color: string; shapeIndex: number; shapePath: string; eyeColor: string }
  | { kind: "word"; color: string; word: string; shapePath: string; icon: null }
  | {
      kind: "word";
      color: string;
      word: string;
      icon: readonly AvatarWordIconNode[];
      shapePath: null;
    };

/** Resolve a stored `bots.color` value for native rendering, including shape paths. */
export function mobileBotAvatarPresentation(color: string): MobileBotAvatarPresentation {
  const parsed = parseBotAvatarValue(color);
  if (parsed.kind === "word") {
    const icon = avatarWordIcon(parsed.word);
    return icon
      ? { ...parsed, icon, shapePath: null }
      : { ...parsed, icon: null, shapePath: avatarWordShapePath(parsed.word) };
  }
  if (parsed.kind !== "shape") return parsed;
  return {
    ...parsed,
    shapePath: shippedBotAvatarShapePath(parsed.shapeIndex),
    eyeColor: resolvePersonaColorDef("preview", parsed.color).eyeColor,
  };
}
