import catalog from "./avatar-word-icons.json" with { type: "json" };

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
  const slugs = [slug];
  if (slug.endsWith("ies") && slug.length > 4) slugs.push(`${slug.slice(0, -3)}y`);
  if (slug.endsWith("es") && slug.length > 4) slugs.push(slug.slice(0, -2));
  if (slug.endsWith("s") && !slug.endsWith("ss") && slug.length > 3) slugs.push(slug.slice(0, -1));
  const first = slug.split("-")[0];
  if (first && first !== slug) slugs.push(first);
  return slugs;
}

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
