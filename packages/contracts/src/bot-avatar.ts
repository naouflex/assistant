import * as z from "zod";

/** Per-bot set. Missing values belong to the original renderer. */
export const BotAvatarSetSchema = z.enum(["organic", "atlas"]);
export type BotAvatarSet = z.infer<typeof BotAvatarSetSchema>;
export const DEFAULT_NEW_BOT_AVATAR_SET: BotAvatarSet = "organic";

/** What Rakazo-era rows and account exports call the "atlas" set. */
export const LEGACY_BOT_AVATAR_SET = "rakazo";

export function resolveBotAvatarSet(value?: string | null): BotAvatarSet {
  return value === "atlas" || value === LEGACY_BOT_AVATAR_SET ? "atlas" : "organic";
}

/** Matches the shipped mascot shapes in `@atlas/core`. */
export const BOT_AVATAR_SHAPE_COUNT = 22;

/** A generated shape is named by a short word, stored with the color. */
export const AVATAR_WORD_MAX_LENGTH = 24;

/**
 * 256x256 webp data URLs from Avatar Studio stay well under this. Cap writes so
 * a pasted raw photo cannot bloat every bot list payload.
 */
export const BOT_AVATAR_VALUE_MAX_LENGTH = 200_000;

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SHAPE_SUFFIX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})::shape_\d+$/;
const WORD_VALUE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})::word_([A-Za-z0-9_-]+)$/;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export type ParsedBotAvatar =
  | { kind: "image"; imageUrl: string }
  | { kind: "shape"; color: string; shapeIndex: number }
  | { kind: "word"; color: string; word: string }
  | { kind: "color"; color: string }
  | { kind: "other"; raw: string };

/** Trimmed, lower-case word a generated shape can be named with. */
export function normalizeAvatarWord(word: string): string | null {
  const normalized = word.normalize("NFC").trim().toLowerCase();
  if (!normalized || normalized.length > AVATAR_WORD_MAX_LENGTH) return null;
  for (const char of normalized) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return null;
  }
  return normalized;
}

/** `#hex::word_…` for a palette color and a word, or null when either is unusable. */
export function botAvatarWordValue(color: string, word: string): string | null {
  const normalized = normalizeAvatarWord(word);
  if (!HEX_COLOR.test(color) || !normalized) return null;
  return `${color}::word_${encodeAvatarWord(normalized)}`;
}

export function parseBotAvatarValue(raw: string): ParsedBotAvatar {
  if (raw.startsWith("data:image/")) {
    return { kind: "image", imageUrl: raw };
  }
  const word = parsedWordAvatar(raw);
  if (word) return { kind: "word", color: word.color, word: word.word };
  if (raw.includes("::shape_")) {
    const parts = raw.split("::shape_");
    const color = parts[0] || "#F97316";
    const rawShape = parts[1] ?? "0";
    const parsedShape = /^\d+$/.test(rawShape) ? Number(rawShape) : 0;
    const shapeIndex = Number.isSafeInteger(parsedShape) ? parsedShape % BOT_AVATAR_SHAPE_COUNT : 0;
    return { kind: "shape", color, shapeIndex };
  }
  if (HEX_COLOR.test(raw)) return { kind: "color", color: raw };
  return { kind: "other", raw };
}

/** True for values we persist on `bots.color` (hex, encoded shape, generated word, or data image). */
export function isBotAvatarValue(raw: string): boolean {
  if (!raw || raw.length > BOT_AVATAR_VALUE_MAX_LENGTH) return false;
  return (
    HEX_COLOR.test(raw) ||
    SHAPE_SUFFIX.test(raw) ||
    parsedWordAvatar(raw) !== null ||
    DATA_IMAGE.test(raw)
  );
}

function parsedWordAvatar(raw: string): { color: string; word: string } | null {
  const match = WORD_VALUE.exec(raw);
  const encoded = match?.[1];
  if (!encoded) return null;
  const word = decodeAvatarWord(encoded);
  if (!word) return null;
  return { color: raw.slice(0, raw.indexOf("::word_")), word };
}

function encodeAvatarWord(word: string): string {
  const bytes = new TextEncoder().encode(word);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeAvatarWord(encoded: string): string | null {
  try {
    const padded =
      encoded.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (encoded.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const word = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return normalizeAvatarWord(word) === word ? word : null;
  } catch {
    return null;
  }
}

export const BotAvatarValueSchema = z
  .string()
  .min(1)
  .max(BOT_AVATAR_VALUE_MAX_LENGTH)
  .refine(isBotAvatarValue, { message: "Invalid bot avatar" });
