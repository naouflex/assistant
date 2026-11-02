import catalog from "./avatar-word-icons.json" with { type: "json" };
import { contrastRatio } from "./bot-avatar-colors.js";

/** One Lucide stroke, in a 24-unit box. The catalog is the Lucide icon set. */
export type AvatarWordIconNode =
  | readonly ["path", string]
  | readonly ["circle", number, number, number]
  | readonly ["ellipse", number, number, number, number]
  | readonly ["line", number, number, number, number]
  | readonly ["rect", number, number, number, number, number]
  | readonly ["polyline", string]
  | readonly ["polygon", string];

const icons = catalog.icons as unknown as Record<string, readonly AvatarWordIconNode[]>;
const aliases = catalog.aliases as unknown as Record<string, string>;

function iconSlugs(word: string): string[] {
  const cleaned = word
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:a|an|the)\s+/, "");
  const slug = cleaned.replace(/\s+/g, "-");
  if (!slug) return [];
  const slugs = [slug];
  // A plural maps to its own picture only. The first word of a phrase does not.
  if (slug.endsWith("s") && !slug.endsWith("ss") && slug.length > 3) slugs.push(slug.slice(0, -1));
  if (slug.endsWith("ies") && slug.length > 4) slugs.push(`${slug.slice(0, -3)}y`);
  if (slug.endsWith("es") && slug.length > 4) slugs.push(slug.slice(0, -2));
  return slugs;
}

/** Ink that stays readable on the bot color. */
export function avatarWordInk(color: string): string {
  return contrastRatio(color, "#141414") >= contrastRatio(color, "#FFFFFF") ? "#141414" : "#FFFFFF";
}

/** The mark drawn when a word has no picture. The same word always uses the same letter. */
export function avatarWordLetter(word: string): string {
  return Array.from(word.trim())[0]?.toLocaleUpperCase("en") ?? "";
}

/** Shrinks a 24-unit picture so it sits inside the disc. */
export const AVATAR_WORD_ICON_TRANSFORM = "translate(12 12) scale(0.62) translate(-12 -12)";

/** The picture for a word when one exists, such as an anchor for "anchor". */
export function avatarWordIcon(word: string): readonly AvatarWordIconNode[] | null {
  for (const slug of iconSlugs(word)) {
    const name = icons[slug] ? slug : aliases[slug];
    if (!name) continue;
    const nodes = icons[name];
    if (nodes) return nodes;
  }
  return null;
}
