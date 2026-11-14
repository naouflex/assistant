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

export const ANNOUNCED_WORK_PROMPT =
  "Your reply only says what you are about to do, and the turn ends there, so nothing would happen. Do it now with your tools and answer with the result; if something blocks you, say what.";
