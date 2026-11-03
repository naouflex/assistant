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
  if (failed.length === 0 || !SUCCESS_CLAIM.test(text) || ADMITS_FAILURE.test(text)) return undefined;
  const lines = failed
    .slice(0, 4)
    .map(
      (outcome) =>
        `- ${outcome.name}${outcome.target ? ` (${outcome.target})` : ""}: ${outcome.error ?? "did not succeed"}`,
    )
    .join("\n");
  return `The reply says the work succeeded, but these tool results did not:\n${lines}\nRewrite the reply so it matches those results.`;
}
