/**
 * Small local models often send tool arguments in a shape the schema check cannot read:
 * the whole object as a JSON string, wrapped in a code fence, or nested under a wrapper
 * key such as `arguments`. pi-ai already repairs broken JSON text and converts scalar
 * types, but a string or a wrapper object reaches the tool as `{}` and the call fails
 * with an unclear error. This unwraps those shapes before the tool reads them.
 */
const WRAPPER_KEYS = ["arguments", "args", "input", "parameters", "params"] as const;

function parseObjectText(text: string): Record<string, unknown> | undefined {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") return parseObjectText(value);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Field names the tool schema declares, or none when the schema has no properties. */
export function declaredArgumentKeys(parameters: unknown): ReadonlySet<string> {
  const properties = (parameters as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  return new Set(properties ? Object.keys(properties) : []);
}

/**
 * Returns the arguments as a plain object. A wrapper key is only unwrapped when the
 * schema does not declare it, so a tool whose real field is `input` keeps it.
 */
export function unwrapToolArguments(
  args: unknown,
  declared: ReadonlySet<string>,
): Record<string, unknown> {
  let current = asObject(args) ?? {};
  for (let depth = 0; depth < 2; depth += 1) {
    const keys = Object.keys(current);
    if (keys.length === 0 || keys.some((key) => declared.has(key))) break;
    const wrapper = WRAPPER_KEYS.find((key) => key in current);
    if (!wrapper) break;
    // `{name, arguments}` echoes the call itself; anything else alongside a wrapper is real data.
    const extra = keys.filter((key) => key !== wrapper && key !== "name");
    if (extra.length) break;
    const inner = asObject(current[wrapper]);
    if (!inner) break;
    current = inner;
  }
  return current;
}
