/**
 * Safe rails for memory reviews ("dreaming").
 *
 * A review proposes small line edits instead of a full rewrite. Edits are applied to
 * the note as it is now, so a suggestion never goes stale because something else
 * wrote the note in between. Only edits that pass every rail are applied without
 * asking; everything else waits for the owner, and anything that looks like a
 * secret is dropped.
 */

export type DreamEdit =
  | { op: "add"; text: string }
  | { op: "replace"; find: string; text: string }
  | { op: "remove"; find: string };

export const MAX_DREAM_EDITS = 12;
/** Auto-apply never removes more than this share of a note's non-empty lines. */
export const MAX_AUTO_REMOVED_SHARE = 0.25;
/** Auto-apply never grows a note by more than this many characters in one review. */
export const MAX_AUTO_ADDED_CHARS = 1_200;
/** At most this many automatic updates per bot per window. */
export const MAX_AUTO_APPLIES_PER_WINDOW = 1;
export const AUTO_APPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How long an automatic update can be undone from the Knowledge section. */
export const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const PIN_PATTERN = /\[pin\]/i;

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function isPinnedLine(line: string): boolean {
  return PIN_PATTERN.test(line);
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
  /\b(?:password|passwd|pwd|secret|api[_ -]?key|token)\s*[:=]\s*\S{6,}/i,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
];

/** True when the text looks like it carries a credential. */
export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/** Masks anything that looks like a credential, for error text we store. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(
      new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`),
      "[redacted]",
    );
  }
  return out;
}

export function parseDreamEdits(value: unknown): DreamEdit[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DREAM_EDITS) return null;
  const edits: DreamEdit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    const find = typeof record.find === "string" ? record.find.trim() : "";
    if (record.op === "add" && text) edits.push({ op: "add", text });
    else if (record.op === "replace" && find && text) edits.push({ op: "replace", find, text });
    else if (record.op === "remove" && find) edits.push({ op: "remove", find });
    else return null;
  }
  return edits;
}

export type AppliedEdits =
  | {
      ok: true;
      content: string;
      added: string[];
      removed: string[];
      pinnedTouched: boolean;
    }
  | { ok: false; reason: string };

/**
 * Applies edits to the note as it is now. A `find` must match exactly one line
 * (ignoring surrounding spaces); otherwise the target moved and the owner decides.
 */
export function applyDreamEdits(current: string, edits: DreamEdit[]): AppliedEdits {
  const lines = current.split("\n");
  const added: string[] = [];
  const removed: string[] = [];
  let pinnedTouched = false;
  for (const edit of edits) {
    if (edit.op === "add") {
      const newLines = edit.text.split("\n");
      while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
      lines.push(...newLines);
      added.push(...newLines.filter((line) => line.trim()));
      continue;
    }
    const matches = lines
      .map((line, index) => (line.trim() === edit.find ? index : -1))
      .filter((index) => index >= 0);
    if (matches.length !== 1) {
      return {
        ok: false,
        reason: matches.length
          ? "A line to change appears more than once."
          : "A line to change is no longer in the note.",
      };
    }
    const index = matches[0]!;
    const old = lines[index]!;
    if (isPinnedLine(old)) pinnedTouched = true;
    removed.push(old);
    if (edit.op === "replace") {
      const newLines = edit.text.split("\n");
      lines.splice(index, 1, ...newLines);
      added.push(...newLines.filter((line) => line.trim()));
    } else {
      lines.splice(index, 1);
    }
  }
  const content = `${lines.join("\n").trimEnd()}\n`;
  return { ok: true, content, added, removed, pinnedTouched };
}

/** Lines in `next` and not in `previous`, and the reverse, for showing a change. */
export function lineChanges(
  previous: string,
  next: string,
): { added: string[]; removed: string[] } {
  const count = (text: string) => {
    const map = new Map<string, number>();
    for (const line of text.split("\n")) {
      const key = line.trim();
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  };
  const before = count(previous);
  const after = count(next);
  const diff = (left: Map<string, number>, right: Map<string, number>) => {
    const out: string[] = [];
    for (const [line, n] of left) {
      for (let i = right.get(line) ?? 0; i < n; i += 1) out.push(line);
    }
    return out;
  };
  return { added: diff(after, before), removed: diff(before, after) };
}

export type DreamRailInput = {
  scope: "bot" | "user";
  /** False when the review returned a full rewrite instead of edits. */
  patch: boolean;
  /** Whether the note already exists; new notes always ask. */
  noteExists: boolean;
  previous: string;
  next: string;
  added: string[];
  removed: string[];
  pinnedTouched: boolean;
  limitChars: number;
  /** Byte cap of the note as the prompt loads it (MEMORY.md); growth past it is dropped. */
  limitBytes?: number;
  autoAppliesInWindow: number;
  autoApplyEnabled: boolean;
};

export type DreamRailDecision =
  | { mode: "auto" }
  | { mode: "ask"; why: string }
  | { mode: "drop"; why: string };

/** Decides whether one suggestion is applied now, waits for the owner, or is dropped. */
export function decideDreamRail(input: DreamRailInput): DreamRailDecision {
  if (looksLikeSecret(input.added.join("\n"))) {
    return { mode: "drop", why: "It looked like it contained a credential." };
  }
  if (input.next.length > input.limitChars) {
    return { mode: "drop", why: "It would not fit in the note." };
  }
  if (input.limitBytes !== undefined) {
    // The prompt cuts MEMORY.md at its byte cap, so growth past it would silently lose the
    // end of the note. Shrinking an oversized note is still allowed.
    const nextBytes = utf8Bytes(input.next);
    if (nextBytes > input.limitBytes && nextBytes > utf8Bytes(input.previous)) {
      return { mode: "drop", why: "It would push the note past its size cap." };
    }
  }
  if (!input.autoApplyEnabled)
    return { mode: "ask", why: "This bot asks before every memory change." };
  if (input.scope !== "bot") return { mode: "ask", why: "Shared memory always asks." };
  if (!input.patch) return { mode: "ask", why: "It rewrites the whole note." };
  if (!input.noteExists) return { mode: "ask", why: "It creates a new note." };
  if (input.pinnedTouched) return { mode: "ask", why: "It changes a pinned line." };
  const existing = input.previous.split("\n").filter((line) => line.trim()).length;
  if (input.removed.length > Math.max(1, Math.floor(existing * MAX_AUTO_REMOVED_SHARE))) {
    return { mode: "ask", why: "It removes more than a quarter of the note." };
  }
  if (input.added.join("\n").length > MAX_AUTO_ADDED_CHARS) {
    return { mode: "ask", why: "It adds a lot at once." };
  }
  if (input.autoAppliesInWindow >= MAX_AUTO_APPLIES_PER_WINDOW) {
    return { mode: "ask", why: "This bot already had an automatic update today." };
  }
  return { mode: "auto" };
}
