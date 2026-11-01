import type { ThinkingLevel } from "@atlas/contracts";
import { LOCAL_PROVIDER_ID } from "./local-provider-identity.js";

/** Local model that writes the reply people read. */
export const LOCAL_ANSWER_MODEL_ID = "qwen3.5:9b";

/** Local model for a helper turn. The router serves this id, with the MTP name as an alias. */
export const LOCAL_FAST_MODEL_ID = "qwen3.5:4b";

const ANSWER_MODEL = /^qwen3\.5:9b(-text)?$/i;

/**
 * A lookup or a plan is worth a short think. A direct reply is not.
 * The user's own words decide it, the same way an option-card request does.
 */
const LOOKUP_OR_PLAN: readonly RegExp[] = [
  /\b(look(?:\s*|-)?up|search the web|search for|find out)\b/i,
  /\bwho(?:'s| is| was)\b/i,
  /\b(earlier (chat|conversation|message)|what did we|what did i (say|ask|tell)|last time)\b/i,
  /\b(latest|current) (news|version|release|price|status)\b/i,
  /\b(what|which) files\b/i,
  /\blist (my |the |your )?(files|folder)\b/i,
  /\b(plan|figure out) how\b/i,
  /\b(break (this|it) down|steps to)\b/i,
  /\bremind me\b/i,
  /\b(cherche|recherche)\b/i,
  /\b(planifie|comment faire)\b/i,
];

export function isLocalAnswerModel(provider: string, modelId: string): boolean {
  return provider === LOCAL_PROVIDER_ID && ANSWER_MODEL.test(modelId.trim());
}

export function needsLookupOrPlan(text: string | undefined): boolean {
  if (!text) return false;
  const head = text.slice(0, 2000);
  return LOOKUP_OR_PLAN.some((pattern) => pattern.test(head));
}

const WEB_LOOKUP: readonly RegExp[] = [
  /\b(look(?:\s*|-)?up|search the web|search for|find out)\b/i,
  /\b(latest|current) (news|version|release|price|status)\b/i,
  /\b(cherche|recherche)\b/i,
];

const NAMED_PERSON = /\bwho(?:'s| is| was)\b/i;
const PRIVATE_PERSON = /\b(i|me|my|mine|you|your)\b/i;

/**
 * A public fact the reply must come from web_search. "Who is my dentist" and
 * "what's your name" stay with memory and the profile.
 */
export function needsWebLookup(text: string | undefined): boolean {
  if (!text) return false;
  const head = text.slice(0, 500);
  if (WEB_LOOKUP.some((pattern) => pattern.test(head))) return true;
  return NAMED_PERSON.test(head) && !PRIVATE_PERSON.test(head);
}

/**
 * A saved thinking level wins. Otherwise a local answer thinks only when the
 * turn is a lookup or a plan, and stays off for a direct reply.
 */
export function localAnswerThinking(input: {
  provider: string;
  explicit: ThinkingLevel | null;
  text: string | undefined;
}): ThinkingLevel | null {
  if (input.provider !== LOCAL_PROVIDER_ID) return input.explicit;
  if (input.explicit) return input.explicit;
  return needsLookupOrPlan(input.text) ? "low" : "off";
}
