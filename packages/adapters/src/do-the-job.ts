/**
 * Small local models copy the previous reply. After a turn that pasted source and told
 * the owner to save it, the next "show me" repeats that, even when the system prompt
 * says to use tools. A note on this turn's message sits after that history.
 */
const DO_THE_JOB_PATTERNS: readonly RegExp[] = [
  /\b(do it|you do it|just do it)\b/i,
  /\b(run|execute|rerun) (it|the|this|that|my|your)\b/i,
  /\bshow (me |it )?(the |an? )?(svg|png|image|logo|picture|file|result)\b/i,
  /\b(svg|png|logo)\b.{0,80}\b(show|attach|file|chat)\b/i,
  /\b(write|create|make|save|generate) (me )?(an? |the )?(svg|png|image|file|logo)\b/i,
  /\b(not the (logo|image|picture)|see the code|as text)\b/i,
  /\b(fais-le|montre[- ]moi)\b/i,
];

export function asksToDoTheJob(text: string | undefined): boolean {
  if (!text) return false;
  return DO_THE_JOB_PATTERNS.some((pattern) => pattern.test(text.slice(0, 2000)));
}

export const DO_THE_JOB_NOTE =
  "This turn is the work, not instructions. Call write_file with the file, then attach_file with that same path, before any sentence. The chat must show the file. Do not paste the file body. Do not tell the user to copy, save, or open it. Do not say you cannot display it.";

/** The per-turn note for a compact local run, or undefined when this turn is not a do-it request. */
export function doTheJobNote(
  text: string | undefined,
  options: { toolsOffered: boolean; voiceCall?: boolean },
): string | undefined {
  if (!options.toolsOffered || options.voiceCall || !asksToDoTheJob(text)) return undefined;
  return DO_THE_JOB_NOTE;
}
