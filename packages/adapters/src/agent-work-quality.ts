/** Verify outcomes before claiming success (all models, minimal tokens). */
export const VERIFY_BEFORE_DONE =
  "Before you say something worked, verify with a tool: re-read the file, run the check command, or open the link you changed.";

/** Recover once with a different approach, then report attempts. */
export const RECOVER_AFTER_FAILURE =
  "If a tool fails or the result looks wrong, try a different tool or approach once, then tell the owner what you tried.";

/** Multi-part requests stay on the scratchpad until each part ships. */
export const SCRATCHPAD_TRACKING =
  "When one message asks for several things, track each part on the scratchpad. Call scratchpad_complete only after that part is actually delivered.";

/** Long jobs get a one-line plan and milestone updates. */
export const MULTI_STEP_PLAN =
  "Before three or more tool steps, add a scratchpad item titled Plan with one short plan. After each major step, add one scratchpad line: done or blocked.";

export const AGENT_WORK_QUALITY_GUIDANCE = [
  VERIFY_BEFORE_DONE,
  RECOVER_AFTER_FAILURE,
  SCRATCHPAD_TRACKING,
  MULTI_STEP_PLAN,
].join(" ");
