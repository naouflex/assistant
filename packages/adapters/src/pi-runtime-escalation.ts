/** Failed tool calls in one run after which the stronger model takes over. */
export const ESCALATE_AFTER_TOOL_ERRORS = 3;
/** Model responses in one run after which the stronger model takes over. */
export const ESCALATE_AFTER_MODEL_RESPONSES = 20;

/**
 * A run moves up once, and only when it is visibly struggling: switching models drops
 * the prompt cache and the previous model's reasoning, so it must be worth paying for.
 */
export function runIsStruggling(progress: { toolErrors: number; modelResponses: number }): boolean {
  return (
    progress.toolErrors >= ESCALATE_AFTER_TOOL_ERRORS ||
    progress.modelResponses >= ESCALATE_AFTER_MODEL_RESPONSES
  );
}
