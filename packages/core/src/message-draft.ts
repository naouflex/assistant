/**
 * The editable draft on a confirm-before-send card: the recipient, subject and body of an outbound
 * email or message, read from the tool's arguments. The owner may change them before sending; the
 * edits replace the same fields in the approved request, so what runs is what the card showed.
 */
export type MessageDraftField = { key: string; label: string; value: string; multiline?: boolean };

const DRAFT_FIELDS: ReadonlyArray<{ keys: string[]; label: string; multiline?: boolean }> = [
  { keys: ["to", "recipient", "recipients", "recipient_email", "to_email"], label: "To" },
  { keys: ["channel", "channel_id", "conversation_id"], label: "Channel" },
  { keys: ["cc"], label: "Cc" },
  { keys: ["bcc"], label: "Bcc" },
  { keys: ["subject", "title"], label: "Subject" },
  {
    keys: ["body", "text", "message", "content", "comment", "message_body"],
    label: "Message",
    multiline: true,
  },
];

export const MESSAGE_DRAFT_VALUE_MAX_LENGTH = 50_000;

function fieldValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length && value.every((item) => typeof item === "string")) {
    return value.join(", ");
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The draft a send card shows, or undefined when the arguments carry no message body. */
export function messageDraftFields(args: Record<string, unknown>): MessageDraftField[] | undefined {
  const fields: MessageDraftField[] = [];
  for (const spec of DRAFT_FIELDS) {
    const key = spec.keys.find((candidate) => fieldValue(args[candidate]) !== undefined);
    if (!key) continue;
    fields.push({
      key,
      label: spec.label,
      value: fieldValue(args[key])!,
      ...(spec.multiline ? { multiline: true } : {}),
    });
  }
  return fields.some((field) => field.multiline) ? fields : undefined;
}

/**
 * The approved request with the owner's edits applied, or undefined when the edits name a field the
 * card did not show or the request no longer holds the values the card showed.
 */
export function applyMessageDraftEdits(
  request: unknown,
  fields: MessageDraftField[],
  edits: Record<string, unknown>,
): unknown {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const [key, value] of Object.entries(edits)) {
    if (!byKey.has(key) || typeof value !== "string") return undefined;
    if (value.length > MESSAGE_DRAFT_VALUE_MAX_LENGTH) return undefined;
  }
  let applied = false;
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (!isObject(node)) return node;
    const holdsDraft =
      !applied && fields.every((field) => fieldValue(node[field.key]) === field.value);
    if (holdsDraft) {
      applied = true;
      const next: Record<string, unknown> = { ...node };
      for (const [key, value] of Object.entries(edits) as Array<[string, string]>) {
        next[key] = Array.isArray(node[key])
          ? value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          : value;
      }
      return next;
    }
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, visit(value)]));
  };
  const result = visit(request);
  return applied ? result : undefined;
}
