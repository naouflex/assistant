export type WorkingLine = {
  action: string;
  detail?: string;
  /** A command, path, or address, set in a fixed-width face so it stays readable. */
  code?: boolean;
};

const PATH_ACTION = /^(Reading|Writing|Listing|Attaching|Opening)\s+(.+)$/;

function isCodeDetail(action: string, detail: string): boolean {
  if (action === "Running" || action.startsWith("Running on ")) return true;
  return /[\\/]/.test(detail) || /\.[A-Za-z0-9]{1,8}$/.test(detail);
}

/**
 * Split a live work line into what the bot is doing and the thing it is about.
 * "Searching the web: injury news" and "Reading notes/plan.md" keep the subject
 * intact instead of one sentence that truncates through the middle.
 */
export function formatWorkingLine(label: string): WorkingLine {
  const line = label.replace(/\s+/g, " ").trim();
  if (!line) return { action: "" };
  const colon = line.indexOf(": ");
  if (colon > 0) {
    const action = line.slice(0, colon).trim();
    const detail = line.slice(colon + 2).trim();
    if (action && detail) {
      return { action, detail, ...(isCodeDetail(action, detail) ? { code: true } : {}) };
    }
  }
  const path = PATH_ACTION.exec(line);
  if (path?.[1] && path[2] && isCodeDetail(path[1], path[2])) {
    return { action: path[1], detail: path[2], code: true };
  }
  return { action: line };
}

/** How long the bot has been on its current step, shown after a short wait so quick replies stay quiet. */
export function workingElapsedLabel(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 3) return "";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
