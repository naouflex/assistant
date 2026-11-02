import type { ParsedBotAvatar } from "@atlas/contracts";
import { parseBotAvatarValue } from "@atlas/contracts";
import type { ShippedBotAvatarShapeFace } from "@atlas/core";
import {
  resolvePersonaColorDef,
  shippedBotAvatarShapeFace,
  shippedBotAvatarShapePath,
} from "@atlas/core";

export type MobileBotAvatarPresentation =
  | Exclude<ParsedBotAvatar, { kind: "shape" }>
  | {
      kind: "shape";
      color: string;
      shapeIndex: number;
      shapePath: string;
      shapeFace: ShippedBotAvatarShapeFace;
      eyeColor: string;
    };

/** Resolve a stored `bots.color` value for native rendering, including shape paths. */
export function mobileBotAvatarPresentation(color: string): MobileBotAvatarPresentation {
  const parsed = parseBotAvatarValue(color);
  if (parsed.kind !== "shape") return parsed;
  return {
    ...parsed,
    shapePath: shippedBotAvatarShapePath(parsed.shapeIndex),
    shapeFace: shippedBotAvatarShapeFace(parsed.shapeIndex),
    eyeColor: resolvePersonaColorDef("preview", parsed.color).eyeColor,
  };
}
