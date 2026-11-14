export type ToolOutcome = { name: string; ok: boolean; error?: string; target?: string };

/** Same tool on a different file, command, or URL is a different result. */
export function toolOutcomeKey(outcome: Pick<ToolOutcome, "name" | "target">): string {
  return outcome.target ? `${outcome.name}\0${outcome.target}` : outcome.name;
}

const SUCCESS_CLAIM =
  /\b(i(?:'ve| have)?\s+(?:done|finished|fixed|sent|saved|updated|created|wrote|shipped|completed)|all set|that(?:'s| is) done|it worked|successfully|c'est fait|j'ai (?:fini|terminé|corrigé|envoyé|enregistré|créé|écrit)|ça a marché|avec succès)\b/i;

const ADMITS_FAILURE =
  /\b(fail(?:ed|ure)?|error|could(?: not|n't)|unable|did(?: not|n't)|was(?: not|n't) able|échou|erreur|impossible|n'a pas|pas pu|je n'ai pas)\b/i;

/** One row per tool: a later success replaces an earlier failure. */
export function latestToolOutcomes(outcomes: readonly ToolOutcome[]): ToolOutcome[] {
  const latest = new Map<string, ToolOutcome>();
  for (const outcome of outcomes) latest.set(toolOutcomeKey(outcome), outcome);
  return [...latest.values()];
}

/** A nudge when the reply claims success and a tool's last result this turn did not. */
export function doneMismatch(text: string, outcomes: readonly ToolOutcome[]): string | undefined {
  const failed = latestToolOutcomes(outcomes).filter((outcome) => !outcome.ok);
  if (failed.length === 0 || !SUCCESS_CLAIM.test(text) || ADMITS_FAILURE.test(text))
    return undefined;
  const lines = failed
    .slice(0, 4)
    .map(
      (outcome) =>
        `- ${outcome.name}${outcome.target ? ` (${outcome.target})` : ""}: ${outcome.error ?? "did not succeed"}`,
    )
    .join("\n");
  return `The reply says the work succeeded, but these tool results did not:\n${lines}\nRewrite the reply so it matches those results.`;
}

// "On it", "Let me check", "I'll look into it": a reply that only announces work. As the last
// message of a turn it is a stall: nothing more happens until the user asks again.
const ANNOUNCES_WORK =
  /^(?:(?:ok(?:ay)?|sure|got it|right|d'accord|ok)[,.!]?\s+)?(?:on it\b|let me\b(?! know)|i(?:'|’)m (?:on it|going to|checking|looking|starting|working|digging)\b|i(?:'|’)ll (?:check|look|investigate|fix|get|find|start|run|do|work|try|dig|take|build|deploy|search|review|go|handle|sort)\b|i will (?:check|look|investigate|fix|start|work|try|dig)\b|checking\b|looking into\b|working on (?:it|that|this)\b|starting (?:now|on)\b|give me a (?:sec|second|moment|minute)\b|one (?:sec|moment)\b|je (?:m(?:'|’)en occupe|vais (?:regarder|vérifier|voir|lancer|corriger|chercher)|regarde|vérifie|lance)\b)/i;

/** A short reply that only says what the agent is about to do, with no result and no question. */
export function announcesWorkOnly(text: string): boolean {
  const reply = text.trim();
  if (!reply || reply.length > 240 || reply.includes("?")) return false;
  return ANNOUNCES_WORK.test(reply);
}

const ENDS_ON_NEXT_STEP =
  /^(?:(?:next|then|now|after that|ensuite|maintenant)[,:]?\s+)?(?:i(?:'|’)ll|i will|i(?:'|’)m going to|je vais)\s+(?:now\s+|then\s+|next\s+)?(?:re-?)?(?:check|run|launch|fix|make|apply|start|deploy|read|compare|sync|build|test|write|update|retry|try|look|pull|push|commit|verify|install|restart|patch|change|add|open|fly|investigate|dig|search|fetch|corriger|lancer|vérifier|relancer|regarder|déployer)\b/i;
const WAITS_ON_OWNER =
  /\b(?:once you|if you|when you|after you|unless you|your (?:go|ok|okay|approval|yes|answer|reply)|reply|say (?:so|go|yes|the word)|tell me|let me know|approve|confirm|si tu|quand tu|dès que tu|dis-moi|ton (?:feu vert|ok|accord))\b/i;

/**
 * A longer reply whose last paragraph only says what the agent will do next, with no question
 * and nothing it waits on from the owner: the turn would end with that step undone.
 */
export function endsOnAnnouncedWork(text: string): boolean {
  const reply = text.trim();
  if (reply.length <= 240) return false;
  const last = reply
    .split(/\n\s*\n/)
    .pop()!
    .trim();
  if (!last || last.length > 300 || last.includes("?") || WAITS_ON_OWNER.test(last)) return false;
  return last
    .split(/(?<=[.!])\s+/)
    .some((sentence) => ENDS_ON_NEXT_STEP.test(sentence.replace(/^[*_>-]+\s*/, "")));
}

export const NEXT_STEP_PROMPT =
  "Your reply ends on what you will do next, and the turn ends there, so it would not happen. If nothing needs the owner, do it now with your tools and answer with the result; if something blocks you or needs the owner's go-ahead, say that instead.";

export const ANNOUNCED_WORK_PROMPT =
  "Your reply only says what you are about to do, and the turn ends there, so nothing would happen. Do it now with your tools and answer with the result; if something blocks you, say what.";

const OFFERS_SAFE_STEP =
  /\b(?:say (?:so|go|yes|the word)|tell me (?:to|if you want)|if you(?:'d| would)? (?:want|like) me to|want me to|shall i|should i|reply (?:with )?["“']?(?:go|yes)|dis-moi si|veux-tu que je|tu veux que je)\b/i;
const SAFE_STEP =
  /\b(?:retry|try (?:it|again|once)|re-?check|check|look|read|search|re-?run|verify|fetch|browse|investigate|diagnose|compare|find|inspect|vérifier|regarder|chercher|réessayer)\b/i;
const RISKY_STEP =
  /\b(?:delete|remove|drop|wipe|restart|reboot|kill|stop|deploy|push|merge|pay|buy|purchase|order|send|email|post|publish|reset|overwrite|install|uninstall|force|rm|supprimer|redémarrer|envoyer|acheter|déployer)\b/i;

/**
 * The last paragraph offers a retry, a read-only check or a search and waits for the owner's go:
 * the agent could have done it. Steps that change, send, spend or restart anything keep the ask.
 */
export function endsOnSafeOffer(text: string): boolean {
  const last = text
    .trim()
    .split(/\n\s*\n/)
    .pop()!
    .trim();
  if (!last || last.length > 400 || !OFFERS_SAFE_STEP.test(last)) return false;
  return SAFE_STEP.test(last) && !RISKY_STEP.test(last);
}

export const SAFE_OFFER_PROMPT =
  "Your reply ends by offering a retry, a check or a search and waiting for the owner's go. A safe, read-only or reversible step needs no go-ahead: do it now with your tools and answer with the result. Keep the question only if the step changes, sends, spends or restarts something, or truly needs the owner's choice.";
