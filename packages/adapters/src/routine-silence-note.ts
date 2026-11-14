import { NO_RESPONSE } from "./silent-reply.js";

/**
 * A routine told to stay silent when nothing is new still tends to explain itself on a
 * repeat wake ("v2.2.0 was already reported, so there is nothing new"), and that
 * explanation posts a bubble and a push. The general silent-reply guidance sits in the
 * system prompt; a routine whose prompt asks for silence gets this note beside it.
 */
const SILENCE_CUES: readonly RegExp[] = [
  /\b(stay|remain|keep|be) (silent|quiet)\b/i,
  /\b(say|send|post|reply) nothing\b/i,
  /\b(don'?t|do not|never) (notify|message|ping|tell|bother|reply|post)\b[^.]{0,60}\b(nothing|no new|unchanged|no change)/i,
  /\bnotify me only\b|\bonly (notify|tell|message|ping) me\b/i,
  /\b(reste|restez|rester) (silencieux|silencieuse|muet)\b/i,
  /\bne (me )?(dis|dites|pr[e\u00e9]viens|pr[e\u00e9]venez) rien\b/i,
];

export function routineAsksForSilence(prompt: string | undefined): boolean {
  if (!prompt) return false;
  return SILENCE_CUES.some((pattern) => pattern.test(prompt));
}

export const ROUTINE_SILENCE_NOTE = `This routine asks for silence when there is nothing new. If everything the check found was already reported (by memory or earlier messages), or nothing changed, or the result was empty, reply with exactly ${NO_RESPONSE} and nothing else: do not say that it was already reported or that there is nothing new. Report only something new, or a check that failed.`;

/** The per-turn note for a routine run whose prompt asks for silence, or undefined. */
export function routineSilenceNote(prompt: string | undefined): string | undefined {
  return routineAsksForSilence(prompt) ? ROUTINE_SILENCE_NOTE : undefined;
}
