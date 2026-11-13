/**
 * Both an account's credits and a key's own spending limit reserve the request's full output
 * cap up front, and both report the largest reservation they would still accept.
 */
const OUTPUT_RESERVATION_LIMITS = new Set(["openrouter_credits", "openrouter_key_limit"]);

/** Below this, a reply (and any thinking) would be cut off; surface the limit instead. */
export const MIN_AFFORDABLE_OUTPUT_TOKENS = 1024;

/** Parse OpenRouter's credit-reservation error, never a model's generated text. */
export function affordableOpenRouterOutput(
  provider: string,
  errorMessage: string | undefined,
  currentLimit: number,
): number | undefined {
  if (
    provider !== "openrouter" ||
    !errorMessage ||
    errorMessage.length > 16_384 ||
    !/^402\b/.test(errorMessage)
  )
    return;
  if (!Number.isSafeInteger(currentLimit) || currentLimit < 1) return;
  try {
    const start = errorMessage.indexOf("{");
    if (start < 0) return;
    const parsed = JSON.parse(errorMessage.slice(start)) as {
      message?: string;
      metadata?: { limit_source?: string };
      error?: { message?: string; metadata?: { limit_source?: string } };
    };
    const error = parsed.error ?? parsed;
    const limitSource = (error.metadata ?? parsed.metadata)?.limit_source;
    if (!limitSource || !OUTPUT_RESERVATION_LIMITS.has(limitSource)) return;
    // This fixed provider error reports the largest output reservation it can accept.
    const match = error.message?.match(
      /^This request requires more credits, or fewer max_tokens\. You requested up to (\d+) tokens, but can only afford (\d+)\./,
    );
    if (!match) return;
    const requested = Number(match[1]);
    const affordable = Number(match[2]);
    if (!Number.isSafeInteger(requested) || !Number.isSafeInteger(affordable)) return;
    if (
      affordable < MIN_AFFORDABLE_OUTPUT_TOKENS ||
      affordable >= requested ||
      affordable >= currentLimit
    )
      return;
    return affordable;
  } catch {
    return;
  }
}
