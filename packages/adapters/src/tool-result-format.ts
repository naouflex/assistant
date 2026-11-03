const MAX_TEXT = 8_000;
const MAX_SHELL_OUT = 4_000;
const MAX_SHELL_ERR = 1_000;
const MAX_ITEMS = 24;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function errorShape(record: Record<string, unknown>): Record<string, unknown> {
  const shaped: Record<string, unknown> = { ok: false, error: String(record.error).trim() };
  if (Array.isArray(record.entries)) shaped.entries = record.entries.slice(0, 12);
  if (typeof record.note === "string") shaped.note = truncate(record.note, 400);
  if (record.untrusted === true) shaped.untrusted = true;
  return shaped;
}

/** Normalize tool JSON for models: short errors, bounded text, explicit ok. */
export function compactToolResultForModel(result: unknown, name: string): unknown {
  if (result === null || result === undefined) return { ok: true };
  if (typeof result === "string") return truncate(result, MAX_TEXT);
  if (typeof result !== "object" || Array.isArray(result)) return result;

  const record = result as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) return errorShape(record);

  if (name === "shell" || name === "user_computer_shell") {
    const exitCode = record.exitCode ?? 0;
    return {
      ok: exitCode === 0,
      exitCode,
      ...(record.stdout !== undefined
        ? { stdout: truncate(String(record.stdout), MAX_SHELL_OUT) }
        : {}),
      ...(record.stderr !== undefined
        ? { stderr: truncate(String(record.stderr), MAX_SHELL_ERR) }
        : {}),
    };
  }

  if (name === "web_fetch") {
    return {
      ok: true,
      ...(record.url !== undefined ? { url: record.url } : {}),
      ...(record.title !== undefined ? { title: record.title } : {}),
      ...(record.content !== undefined
        ? { content: truncate(String(record.content), MAX_TEXT) }
        : {}),
    };
  }

  if (name === "read_file" || name === "read_memory") {
    const content = typeof record.content === "string" ? record.content : undefined;
    return {
      ok: true,
      ...(record.path !== undefined ? { path: record.path } : {}),
      ...(content !== undefined ? { content: truncate(content, MAX_TEXT) } : {}),
      ...(record.revision !== undefined ? { revision: record.revision } : {}),
    };
  }

  if (Array.isArray(record.results)) {
    const results = record.results.slice(0, MAX_ITEMS);
    return {
      ok: true,
      results,
      ...(record.results.length > results.length ? { truncated: true } : {}),
    };
  }

  for (const key of ["content", "text", "body", "output"]) {
    if (typeof record[key] === "string" && String(record[key]).length > MAX_TEXT) {
      return { ok: record.ok ?? true, ...record, [key]: truncate(String(record[key]), MAX_TEXT) };
    }
  }

  if (record.ok === undefined && !("error" in record)) return { ok: true, ...record };
  return record;
}
