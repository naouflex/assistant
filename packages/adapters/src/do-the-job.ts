/**
 * Small local models copy the previous reply. After a turn that pasted source and told
 * the owner to save it, the next "show me" repeats that, even when the system prompt
 * says to use tools. A note on this turn's message sits after that history.
 */
const DO_THE_JOB_PATTERNS: readonly RegExp[] = [
  /\b(do it|you do it|just do it)\b/i,
  /\b(run|execute|rerun) (it|the|this|that|my|your|date|the code)\b/i,
  /\bshow (me |it )?(the |an? )?(svg|png|image|logo|picture|file|result)\b/i,
  /\b(svg|png|logo)\b.{0,80}\b(show|attach|file|chat)\b/i,
  /\b(write|create|make|save|generate) (me )?(an? |the )?(svg|png|image|file|logo)\b/i,
  /\b(create|make) .{0,60}\b(containing|with exactly)\b/i,
  /\bon (your|the) (computer|sandbox|machine)\b/i,
  /\bin (the )?terminal\b/i,
  /\b(not the (logo|image|picture)|see the code|as text)\b/i,
  /\bfix (it|this|that)\b/i,
  /\b(fais-le|montre[- ]moi)\b/i,
];

export function asksToDoTheJob(text: string | undefined): boolean {
  if (!text) return false;
  return DO_THE_JOB_PATTERNS.some((pattern) => pattern.test(text.slice(0, 2000)));
}

export const DO_THE_JOB_NOTE =
  "This turn requires tool calls before any reply. To run code, call shell first. For a file or image in chat: write_file then attach_file with the same path in this turn. Do not paste file bodies. Do not tell the user to copy, save, or open anything. Do not say you cannot display it.";

/** The per-turn note for a compact local run, or undefined when this turn is not a do-it request. */
export function doTheJobNote(
  text: string | undefined,
  options: { toolsOffered: boolean; voiceCall?: boolean },
): string | undefined {
  if (!options.toolsOffered || options.voiceCall || !asksToDoTheJob(text)) return undefined;
  return DO_THE_JOB_NOTE;
}
