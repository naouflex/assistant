/** Spoken turns that need tools first, not a chatty answer from memory. */
const VOICE_ACTION_PATTERNS: readonly RegExp[] = [
  /\b(look up|look that up|search the web|search for|google)\b/i,
  /\bremind me\b/i,
  /\bremember\b/i,
  /\brun date\b/i,
  /\b(run|execute)\b/i,
  /\bin (the )?terminal\b/i,
  /\b(every|each) (weekday|morning|day|week)\b/i,
  /\bschedule\b/i,
  /\b(do it|you do it|just do it|fix (it|this))\b/i,
  /\bwhat('s| is) on my calendar\b/i,
  /\bon (your|the) (computer|sandbox)\b/i,
];

export const VOICE_ACTION_NOTE =
  "Live call: run the needed tool before you speak. Then answer in one or two short sentences with what you found or did. Do not say you will do it later or describe steps you did not take.";

export function voiceActionNote(
  text: string | undefined,
  options: { voiceCall?: boolean },
): string | undefined {
  if (!options.voiceCall || !text) return undefined;
  return VOICE_ACTION_PATTERNS.some((pattern) => pattern.test(text.slice(0, 2000)))
    ? VOICE_ACTION_NOTE
    : undefined;
}
