const MAX_TEXT = 8_000;
const MAX_SHELL_OUT = 4_000;
const MAX_SHELL_ERR = 1_000;

const SHELL_TOOLS = new Set(["shell", "user_computer_shell", "phone_shell"]);

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function textLimit(key: string): number {
  if (key === "stdout" || key === "output") return MAX_SHELL_OUT;
  if (key === "stderr") return MAX_SHELL_ERR;
  return MAX_TEXT;
}

/** Shell tools report the exit as exitCode (bot computer) or code (user computer / phone). */
function shellExitCode(record: Record<string, unknown>): number | undefined {
  if (typeof record.exitCode === "number") return record.exitCode;
  if (typeof record.code === "number") return record.code;
  return undefined;
}

/** A shell result succeeded only when it reported a zero exit and was not stopped. */
export function shellResultSucceeded(record: Record<string, unknown>): boolean {
  if (record.timedOut === true || record.killed === true) return false;
  if (typeof record.signal === "string" && record.signal.trim()) return false;
  return shellExitCode(record) === 0;
}

function shellFailureReason(record: Record<string, unknown>): string {
  if (record.timedOut === true) return "The command timed out.";
  if (record.killed === true || (typeof record.signal === "string" && record.signal.trim())) {
    return "The command was killed.";
  }
  const exitCode = shellExitCode(record);
  if (exitCode === undefined) return "The command did not report an exit code.";
  return `The command failed with exit code ${exitCode}.`;
}

function shortenValue(key: string, value: unknown): unknown {
  if (typeof value === "string") return truncate(value, textLimit(key));
  return value;
}

/**
 * Keep every field the tool returned. Only long text is shortened.
 * A shell-like result is not successful unless it reported a clean exit.
 */
export function compactToolResultForModel(result: unknown, name: string): unknown {
  if (result === null || result === undefined) {
    return { ok: false, error: "The tool did not report a result." };
  }
  if (typeof result === "string") {
    return { text: truncate(result, MAX_TEXT), ok: true };
  }
  if (typeof result !== "object" || Array.isArray(result)) return result;

  const record = result as Record<string, unknown>;
  const shaped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    shaped[key] = shortenValue(key, value);
  }

  const reportedError = typeof record.error === "string" && record.error.trim().length > 0;
  if (SHELL_TOOLS.has(name)) {
    const ok = !reportedError && shellResultSucceeded(record);
    shaped.ok = ok;
    if (!ok && shaped.error === undefined) shaped.error = shellFailureReason(record);
    return shaped;
  }

  if (reportedError) {
    shaped.ok = false;
    return shaped;
  }
  if (shaped.ok === undefined) shaped.ok = true;
  return shaped;
}

export function toolReportedFailure(name: string, result: unknown): boolean {
  const shaped = compactToolResultForModel(result, name);
  return (
    shaped !== null &&
    typeof shaped === "object" &&
    !Array.isArray(shaped) &&
    (shaped as { ok?: unknown }).ok === false
  );
}

export function toolFailureText(result: unknown): string {
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const error = (result as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error.slice(0, 300);
  }
  return "The tool did not succeed.";
}
