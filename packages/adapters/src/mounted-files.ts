/**
 * Host folders the operator mounts into every computer (SANDBOX_COMPUTER_MOUNTS) are invisible
 * to the model unless it looks. Small local models tend to answer "I can't see your files"
 * instead of running ls, so a turn that asks about the user's own repos or files gets a short
 * note naming the mount folder and what is in it.
 */
const MOUNT_TARGET_ROOTS = ["/mnt", "/media", "/srv"];
const MAX_LISTED_NAMES = 30;

export type MountedFolders = { roots: string[]; names: string[] };

/** Mount targets from SANDBOX_COMPUTER_MOUNTS (`source:target[:opts]`, comma separated), grouped by parent folder. */
export function mountedFolders(value: string | undefined): MountedFolders {
  const roots: string[] = [];
  const names: string[] = [];
  for (const entry of (value ?? "").split(",")) {
    const target = entry.split(":")[1]?.trim().replace(/\/+$/, "");
    if (!target || !MOUNT_TARGET_ROOTS.some((root) => target.startsWith(`${root}/`))) continue;
    const parts = target.split("/").filter(Boolean);
    // /mnt/shared is its own root; /mnt/naoufel/<repo>[/sub] groups under /mnt/naoufel.
    const root = parts.length > 2 ? `/${parts.slice(0, 2).join("/")}` : target;
    if (!roots.includes(root)) roots.push(root);
    const name = parts[2];
    if (name && !names.includes(name)) names.push(name);
  }
  return { roots, names };
}

const FILES_PATTERNS: readonly RegExp[] = [
  /\bmy (git )?(repos?|repositories|projects?|code ?base|source code|files|folders?|directories)\b/i,
  /\bmy (wsl )?home (folder|directory|dir)\b/i,
  /\bwsl\b/i,
  /(^|\s)~\//,
  /\b(mes|mon) (d[e\u00e9]p[o\u00f4]ts?|repos?|projets?|fichiers|dossiers?|r[e\u00e9]pertoires?|code)\b/i,
  /\b(dossier|r[e\u00e9]pertoire) (perso(nnel)?|home|utilisateur)\b/i,
];

export function asksAboutOwnFiles(text: string | undefined): boolean {
  if (!text) return false;
  const head = text.slice(0, 2000);
  return FILES_PATTERNS.some((pattern) => pattern.test(head));
}

export function mountedFilesNote(folders: MountedFolders): string | undefined {
  if (!folders.roots.length) return undefined;
  const where = folders.roots.join(", ");
  const listed = folders.names.slice(0, MAX_LISTED_NAMES);
  const more = folders.names.length > listed.length ? ", \u2026" : "";
  const contents = listed.length ? ` (one folder per repo: ${listed.join(", ")}${more})` : "";
  return `The user's files are mounted read-only in your computer at ${where}${contents}. Run ls ${folders.roots[0]} with the shell tool before answering; never say they aren't mounted.`;
}

/** The per-turn note, or undefined when nothing is mounted, the shell is not offered, or the turn is not about the user's files. */
export function ownFilesNote(
  text: string | undefined,
  options: { shellOffered: boolean; mounts?: string; voiceCall?: boolean },
): string | undefined {
  if (!options.shellOffered || options.voiceCall || !asksAboutOwnFiles(text)) return undefined;
  return mountedFilesNote(mountedFolders(options.mounts));
}
