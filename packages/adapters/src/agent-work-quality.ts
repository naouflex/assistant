/**
 * Claim success only from evidence, without paying a second round trip for it: a tool result
 * that already confirms the effect is the evidence; content the bot produced still gets checked.
 */
export const VERIFY_BEFORE_DONE =
  "Claim success only from evidence. A tool result that confirms the effect (ok, the saved path, the created id or next run) is enough: do not re-read, re-list or re-fetch it just to double-check. When success depends on content you produced, check it: run the code or test, or open the page you changed.";

/** Recover once with a different approach, then report attempts. */
export const RECOVER_AFTER_FAILURE =
  "If a tool fails or the result looks wrong, try a different tool or approach once, then tell the owner what you tried.";

/** Multi-part requests stay on the scratchpad until each part ships. */
export const SCRATCHPAD_TRACKING =
  "When one message asks for several things, track each part on the scratchpad. Call scratchpad_complete only after that part is actually delivered.";

/** Long jobs get a one-line plan and milestone updates; short ones just get done. */
export const MULTI_STEP_PLAN =
  "For long work (about five or more tool steps, or work that may outlive this turn), add a scratchpad item titled Plan with one short plan, then one scratchpad line per milestone: done or blocked.";

/**
 * Ask only when a guess could do real harm, and never twice: settled answers, small reversible
 * details and sensible defaults are the assistant's to apply, saying the assumption in passing.
 */
export const DECIDE_OR_ASK =
  "Never ask again what the conversation or memory already settles; act on it. Decide small, reversible details yourself (a file name, wording, a sensible default such as the account time zone) and name the assumption in a few words. Ask one short question first only when a wrong guess would touch the wrong person, record, money or something hard to undo, and name the candidates you found.";

/** Independent calls go out together, which cuts a round trip per call. */
export const PARALLEL_CALLS =
  "When several tool calls do not depend on each other's results, make them together in one step.";

/** An ack or a plan is never the whole turn; continue/retry resumes open work. */
export const FINISH_THE_TURN =
  "Keep calling tools until the request is done or blocked; an ack or a plan is never the whole reply. End with the result or the blocker. When the owner says continue or retry, resume the last unfinished request from this conversation and the scratchpad instead of asking what to do.";

export const AGENT_WORK_QUALITY_GUIDANCE = [
  FINISH_THE_TURN,
  DECIDE_OR_ASK,
  VERIFY_BEFORE_DONE,
  PARALLEL_CALLS,
  RECOVER_AFTER_FAILURE,
  SCRATCHPAD_TRACKING,
  MULTI_STEP_PLAN,
].join(" ");
