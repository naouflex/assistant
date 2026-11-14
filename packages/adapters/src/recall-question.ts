/**
 * Asked about something said earlier, models tend to answer with the fact plus everything
 * near it: the other project's value, the option that was rejected, the details that were
 * discussed instead. System guidance alone sits too far from the question to stop that, so a
 * recall question gets a short per-turn note right next to it.
 */
const RECALL_PATTERNS: readonly RegExp[] = [
  /\b(did|have|had) (we|i|you) (choose|chose|pick|picked|decide|decided|agree|agreed|select|selected|settle|settled|say|said|discuss|discussed|mention|mentioned|tell|told)\b/i,
  /\bwe (chose|picked|decided|agreed|selected|settled on|discussed)\b/i,
  /\b(approved|agreed|decided|chosen|settled|planned)\b[^?]{0,80}\?/i,
  // A short question about "the" or "our" something usually means the one already discussed.
  /^\s*what (is|are|was|were) (the|our|my) [^?]{1,60}\?\s*$/i,
  // "Remind me of the batch size", not "remind me every weekday at 8:30".
  /\bremind me (of|what|which|who|how|where|why)\b/i,
  /\b(do you remember|do you recall)\b/i,
  /\bwhat (was|were) (that|those|the|our|my)\b/i,
  /\b(again|earlier|last time|previously)\s*\?/i,
  /\b(on avait|nous avions|on a|avions-nous|avait-on) (choisi|d[e\u00e9]cid[e\u00e9]|dit|convenu|retenu)\b/i,
  /\brappelle[- ]moi (le|la|les|ce|quel|quelle|quels|quelles|comment|o[u\u00f9])\b/i,
  /\b(tu te souviens|vous vous souvenez)\b/i,
];

export function isRecallQuestion(text: string | undefined): boolean {
  if (!text) return false;
  const head = text.slice(0, 600);
  return RECALL_PATTERNS.some((pattern) => pattern.test(head));
}

export const RECALL_NOTE =
  "If this asks about something from earlier in the conversation, answer with that fact for the thing named, on its own: do not mention similar facts about other things, or options that were replaced or rejected. If it was never discussed, say so without listing what was. If several things fit and the question does not say which, ask which one by naming the things only: do not give any of their values.";

/** The per-turn note for a recall question, or undefined. */
export function recallNote(
  text: string | undefined,
  options: { voiceCall?: boolean } = {},
): string | undefined {
  if (options.voiceCall) return undefined;
  return isRecallQuestion(text) ? RECALL_NOTE : undefined;
}
