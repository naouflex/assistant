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

const ON_THIS_COMPUTER =
  /\b(your|this) (computer|machine)\b|\b(start|install|run|launch|restart)\b|\btry again\b/i;

/** The owner wants the page on their own machine, where localhost is their browser. */
const ON_OWNER_LAPTOP =
  /\b(my laptop|my pc|my computer|my machine)\b|\blocally\b|\blocalhost\b|\b127\.0\.0\.1\b|\breplay\b/i;

const MOUNT_PATH = /\/mnt\/[A-Za-z0-9._/-]+/g;

/** Mount paths named in the bot's own instructions, longest first. */
export function instructedMountPaths(instructions: string | undefined): string[] {
  const found = new Set<string>();
  for (const match of instructions?.match(MOUNT_PATH) ?? []) {
    found.add(match.replace(/[./]+$/, ""));
  }
  return [...found].sort((a, b) => b.length - a.length);
}

/** A mounted folder the message names, as its path on this computer. */
export function mentionedMountPaths(text: string, mounts: string | undefined): string[] {
  const head = text.toLowerCase();
  const found: string[] = [];
  for (const entry of (mounts ?? "").split(",")) {
    const target = entry.split(":")[1]?.trim().replace(/\/+$/, "");
    const name = target?.split("/").filter(Boolean).at(-1);
    // Short last segments (docs, src) match ordinary sentences.
    if (!target || !name || (name.length < 8 && !name.includes("-"))) continue;
    if (!MOUNT_TARGET_ROOTS.some((root) => target === root || target.startsWith(`${root}/`)))
      continue;
    if (head.includes(name.toLowerCase()) && !found.includes(target)) found.push(target);
  }
  return found;
}

/** Source path of a mount (`source:target[:opts]`), when the target is one of ours. */
export function mountSource(mounts: string | undefined, target: string): string | undefined {
  for (const entry of (mounts ?? "").split(",")) {
    const [source, dest] = entry.split(":");
    if (dest?.trim().replace(/\/+$/, "") === target && source?.trim().startsWith("/")) {
      return source.trim();
    }
  }
  return undefined;
}

/**
 * Sits after the chat so a small model does not repeat the owner's WSL path or open
 * their Windows shell. list_files cannot see these mounts; shell can.
 * A Grok local agent ran on the owner's laptop, so a request for that laptop, or for
 * localhost in their browser, uses user_computer_shell and wsl on the mount's source.
 */
export function mountWorkNote(
  text: string | undefined,
  options: {
    shellOffered: boolean;
    mounts?: string;
    voiceCall?: boolean;
    instructions?: string;
    userComputerPlatform?: string;
  },
): string | undefined {
  if (!text || options.voiceCall || !options.shellOffered) return undefined;
  if (!mountedFolders(options.mounts).roots.length) return undefined;
  const head = text.slice(0, 2000);
  const named = mentionedMountPaths(head, options.mounts);
  const instructed = instructedMountPaths(options.instructions);
  const act = ON_THIS_COMPUTER.test(head);
  const laptop =
    ON_OWNER_LAPTOP.test(head) || (act && /owner's laptop/.test(options.instructions ?? ""));
  if (!named.length && !act && !laptop && !asksAboutOwnFiles(head)) return undefined;
  const path = named[0] ?? instructed[0];
  const source = path ? mountSource(options.mounts, path) : undefined;
  if (laptop && source && options.userComputerPlatform === "win32") {
    const body =
      options.instructions?.includes("start.sh") === true
        ? `cd ${source} && nohup ./start.sh --host 0.0.0.0 --port 8000 > /tmp/atlas-start.log 2>&1 &`
        : `ls ${source}`;
    return `This turn is the owner's laptop, not your computer. Call user_computer_shell before any sentence, with command wsl -e bash -lc '${body}'. http://localhost:8000 is their browser. Do not use shell. Do not web_fetch 127.0.0.1 or localhost. Do not ask where the project is.`;
  }
  // A start request otherwise copies the previous pasted command, which used the WSL path.
  if (act && path) {
    const command =
      options.instructions?.includes(path) && options.instructions.includes("start.sh")
        ? `cd ${path} && nohup ./start.sh > /tmp/atlas-start.log 2>&1 &`
        : `ls ${path}`;
    return `Call the shell tool before any sentence, with command ${command}. That folder is on your computer. /home/naoufel does not exist here or on Windows. Do not paste a command, do not repeat the earlier /home command, and do not call user_computer_shell or list_files.`;
  }
  const where = named.length ? named.join(", ") : "the /mnt path in your instructions";
  return `Your computer is the shell tool. Use ${where}. A /home path from the owner's WSL does not exist on this computer or on their Windows PC: do not cd to it, do not repeat a command that used it, and do not call user_computer_shell or list_files for it.`;
}

/**
 * list_files and read_file are rooted in the bot home, so an absolute mount or WSL path
 * 404s and the model decides the folder is missing. Tell it to use shell instead.
 */
export function outsideWorkspaceFileHint(requested: string): string | undefined {
  const path = requested.trim().replaceAll("\\", "/");
  if (!path.startsWith("/")) return undefined;
  if (path === "/home/atlas" || path.startsWith("/home/atlas/")) return undefined;
  if (MOUNT_TARGET_ROOTS.some((root) => path === root || path.startsWith(`${root}/`)))
    return `${path} is on your computer, but list_files and read_file only see the bot home. Use shell, for example ls ${path}. Do not use user_computer_shell.`;
  if (path.startsWith("/home/") || path.startsWith("/Users/"))
    return `${path} is not on your computer. Mounted folders are under /mnt. Use shell with that /mnt path. Do not use user_computer_shell.`;
  return undefined;
}
