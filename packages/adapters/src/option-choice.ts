/**
 * Small local models often write a choice out as a numbered list even when the user asked to
 * pick. When the user's own words ask for options, the turn gets a short note that points the
 * model at ask_user, so the choice shows as tappable option cards.
 */
const CHOICE_PATTERNS: readonly RegExp[] = [
  /\blet me (choose|pick|decide)\b/i,
  /\b(give|show|offer) me (a few |some |two |three |four |[2-4] )?(options|choices)\b/i,
  /\b(options|choices) (to|i can|for me to) (pick|choose) from\b/i,
  /\b(which|what) (one|option) should i (pick|choose|go with)\b/i,
  /\b(laisse[- ]moi|je veux) (choisir|d[e\u00e9]cider)\b/i,
  /\b(propose|donne)[- ]moi (des|quelques|[2-4]) (options|choix)\b/i,
];

export function wantsOptionChoice(text: string | undefined): boolean {
  if (!text) return false;
  const head = text.slice(0, 2000);
  return CHOICE_PATTERNS.some((pattern) => pattern.test(head));
}

export const OPTION_CHOICE_NOTE =
  "The user wants to pick from options: call ask_user with one short question and two to four short option labels instead of writing the options as text.";

/** The per-turn note, or undefined when the user did not ask to choose or ask_user is not offered. */
export function optionChoiceNote(
  text: string | undefined,
  options: { askUserOffered: boolean; voiceCall?: boolean },
): string | undefined {
  if (!options.askUserOffered || options.voiceCall) return undefined;
  return wantsOptionChoice(text) ? OPTION_CHOICE_NOTE : undefined;
}
