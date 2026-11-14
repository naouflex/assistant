import { redact } from "./report.js";

/**
 * Real-turn review: grades bot turns taken from a real deployment (exported locally, never
 * committed) against one versioned rubric. Each turn gets a completion grade and zero or more
 * failure categories, so a sample yields counts per category rather than one pass rate.
 */
export const REAL_TURN_RUBRIC_VERSION = "real-turn-v1";

export const REAL_TURN_ISSUES = [
  "incomplete",
  "stalled",
  "re_ask",
  "hallucination",
  "verbose",
  "tool_misuse",
  "ignored_instruction",
  "poor_error_handling",
] as const;
export type RealTurnIssue = (typeof REAL_TURN_ISSUES)[number];

export const REAL_TURN_COMPLETIONS = ["done", "partial", "failed", "not_applicable"] as const;
export type RealTurnCompletion = (typeof REAL_TURN_COMPLETIONS)[number];

export type RealTurnMessage = { role: string; text: string };
export type RealTurnTool = {
  name: string;
  input: string;
  status: string;
  output: string | null;
};

/** One user turn and what the bot did with it. Text fields are already truncated by the export. */
export type RealTurn = {
  id: string;
  bot: string;
  trigger: string;
  runStatus: string;
  runError: string | null;
  context: RealTurnMessage[];
  user: string;
  reply: string;
  tools: RealTurnTool[];
  toolCount: number;
  nextUser: string | null;
};

export type RealTurnVerdict = {
  reason: string;
  completion: RealTurnCompletion;
  issues: RealTurnIssue[];
  severity: 0 | 1 | 2 | 3;
};

export const REAL_TURN_RUBRIC = `Rubric ${REAL_TURN_RUBRIC_VERSION}. You review one real turn of a personal AI agent: the recent conversation, the user's message, the agent's reply (text, cards that ask the user, and a summary of tool steps), the side-effecting tool calls it made (read-only tools such as searches and file reads are summarised only in the steps), the run status, and the user's next message when there is one.
Grade completion: "done" when the reply does what was asked or answers it; "partial" when some of it is done; "failed" when nothing useful was achieved; "not_applicable" when the message needed no work (a thanks, an acknowledgement, a cancelled run with nothing expected).
List every issue that clearly applies, using only these ids:
- incomplete: stopped before the job was done without a real blocker, or left out part of the request.
- stalled: ended on a plan, a promise ("I'll do X") or a progress note instead of doing the work, or a run that went quiet.
- re_ask: asked the user for something already given, inferable from the context, or easy to look up, or asked for a confirmation that was not needed. Asking before a risky, irreversible or genuinely ambiguous step is not re_ask.
- hallucination: stated facts, results or completed actions that the tool calls and context do not support, such as claiming success without evidence.
- verbose: much longer than the request needed: filler, repetition, restating the question, or long reports where a line would do.
- tool_misuse: wrong tool, the same failing call repeated without changing approach, many needless calls, or answering from guesswork when a tool was needed.
- ignored_instruction: did not follow an explicit instruction, constraint or correction from the user.
- poor_error_handling: a failure (tool error, failed or cancelled run) left unexplained, raw error text dumped on the user, or no next step offered.
The user's next message is evidence: a correction, a repeat of the request or frustration usually shows the turn fell short. Do not penalise the agent for content you cannot see; judge only what the evidence shows. Severity: 0 no issue, 1 minor, 2 noticeable to the user, 3 the turn failed the user.
Return only a JSON object: {"reason": string, "completion": string, "issues": string[], "severity": number}. Keep the reason under 40 words and do not quote secrets or personal details.`;

const EXTRA_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bxox[abposr]-[A-Za-z0-9-]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b(?:gh[oprsu]_|glpat-|sk_live_|rk_live_|sk_test_|whsec_)[A-Za-z0-9_-]+/g,
  /\b[0-9a-f]{40,}\b/gi,
  // Long mixed-case tokens with a digit: keys and session ids, not words or paths.
  /\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*[a-z])[A-Za-z0-9+/_-]{40,}={0,2}/g,
  /\+\d[\d\s().-]{7,}\d/g,
];

/** Strips credentials and personal identifiers before a turn leaves the machine. */
export function scrubTurnText(text: string): string {
  let safe = redact(text);
  for (const pattern of EXTRA_SECRET_PATTERNS) safe = safe.replace(pattern, "[redacted]");
  return safe;
}

function scrubTurn(turn: RealTurn) {
  return {
    trigger: turn.trigger,
    runStatus: turn.runStatus,
    runError: turn.runError ? scrubTurnText(turn.runError) : null,
    context: turn.context.map((m) => ({ role: m.role, text: scrubTurnText(m.text) })),
    user: scrubTurnText(turn.user),
    reply: scrubTurnText(turn.reply),
    toolCalls: turn.toolCount,
    tools: turn.tools.map((t) => ({
      name: t.name,
      status: t.status,
      input: scrubTurnText(t.input),
      output: t.output === null ? null : scrubTurnText(t.output),
    })),
    nextUserMessage: turn.nextUser ? scrubTurnText(turn.nextUser) : null,
  };
}

/** The judge prompt for one turn: the rubric, then the scrubbed evidence as data. */
export function realTurnPrompt(turn: RealTurn): string {
  return JSON.stringify({ rubric: REAL_TURN_RUBRIC, evidence: scrubTurn(turn) });
}

function firstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return;
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\\") i++;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
}

/** Parses a verdict, failing closed on anything outside the rubric's vocabulary. */
export function parseRealTurnVerdict(text: string): RealTurnVerdict {
  const json = firstJsonObject(text);
  if (!json) throw new Error("Invalid real-turn verdict");
  const value = JSON.parse(json) as Record<string, unknown>;
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  const completion = value.completion as RealTurnCompletion;
  const severity = value.severity as RealTurnVerdict["severity"];
  if (
    !reason ||
    !REAL_TURN_COMPLETIONS.includes(completion) ||
    ![0, 1, 2, 3].includes(severity) ||
    !Array.isArray(value.issues) ||
    !value.issues.every((issue) => REAL_TURN_ISSUES.includes(issue as RealTurnIssue))
  )
    throw new Error("Invalid real-turn verdict");
  return { reason, completion, issues: [...new Set(value.issues as RealTurnIssue[])], severity };
}

export type RealTurnSummary = {
  graded: number;
  clean: number;
  completion: Record<RealTurnCompletion, number>;
  issues: Array<{ issue: RealTurnIssue; turns: number; severe: number }>;
  byBot: Array<{ bot: string; graded: number; clean: number }>;
  meanSeverity: number;
};

/** A clean turn is done or not applicable, with no issue above minor. */
export function isCleanTurn(verdict: RealTurnVerdict): boolean {
  return (
    (verdict.completion === "done" || verdict.completion === "not_applicable") &&
    verdict.severity <= 1
  );
}

export function summarizeRealTurns(
  graded: Array<{ turn: Pick<RealTurn, "bot">; verdict: RealTurnVerdict }>,
): RealTurnSummary {
  const completion = Object.fromEntries(REAL_TURN_COMPLETIONS.map((c) => [c, 0])) as Record<
    RealTurnCompletion,
    number
  >;
  const issues = new Map<RealTurnIssue, { turns: number; severe: number }>();
  const bots = new Map<string, { graded: number; clean: number }>();
  let clean = 0;
  let severity = 0;
  for (const { turn, verdict } of graded) {
    completion[verdict.completion]++;
    severity += verdict.severity;
    const ok = isCleanTurn(verdict);
    if (ok) clean++;
    const bot = bots.get(turn.bot) ?? { graded: 0, clean: 0 };
    bot.graded++;
    if (ok) bot.clean++;
    bots.set(turn.bot, bot);
    for (const issue of verdict.issues) {
      const count = issues.get(issue) ?? { turns: 0, severe: 0 };
      count.turns++;
      if (verdict.severity >= 2) count.severe++;
      issues.set(issue, count);
    }
  }
  return {
    graded: graded.length,
    clean,
    completion,
    issues: [...issues]
      .map(([issue, count]) => ({ issue, ...count }))
      .sort((a, b) => b.turns - a.turns || a.issue.localeCompare(b.issue)),
    byBot: [...bots]
      .map(([bot, count]) => ({ bot, ...count }))
      .sort((a, b) => b.graded - a.graded || a.bot.localeCompare(b.bot)),
    meanSeverity: graded.length ? severity / graded.length : 0,
  };
}

function turn(partial: Partial<RealTurn> & Pick<RealTurn, "id" | "user" | "reply">): RealTurn {
  return {
    bot: "calibration",
    trigger: "user",
    runStatus: "completed",
    runError: null,
    context: [],
    tools: [],
    toolCount: partial.tools?.length ?? 0,
    nextUser: null,
    ...partial,
  };
}

/**
 * Synthetic anchors the judge must grade as labelled before it grades real turns. `issues`
 * must all be reported; `clean` anchors must come back with no issue above minor.
 */
export const REAL_TURN_CALIBRATION: Array<{
  turn: RealTurn;
  issues: RealTurnIssue[];
  clean?: boolean;
}> = [
  {
    clean: true,
    issues: [],
    turn: turn({
      id: "cal-clean",
      user: "What time is it in Tokyo when it's 9am in Paris?",
      reply: "4pm in Tokyo.",
    }),
  },
  {
    issues: ["stalled"],
    turn: turn({
      id: "cal-stalled",
      user: "Rename every .txt file in ~/notes to .md",
      reply:
        "Sure! I'll go through the folder and rename each .txt file to .md. Let me get started.",
    }),
  },
  {
    issues: ["hallucination"],
    turn: turn({
      id: "cal-hallucination",
      user: "Deploy the staging branch.",
      reply: "Done: staging is deployed and healthy.",
      tools: [
        {
          name: "shell",
          input: '{"command":"./deploy.sh staging"}',
          status: "completed",
          output: '{"exitCode":1,"stderr":"error: permission denied"}',
        },
      ],
    }),
  },
  {
    issues: ["re_ask"],
    turn: turn({
      id: "cal-re-ask",
      context: [
        { role: "user", text: "My flight is AF1234 on Friday." },
        { role: "bot", text: "Noted." },
      ],
      user: "Can you check if my flight is on time?",
      reply: "Sure, what's your flight number and date?",
    }),
  },
  {
    issues: ["tool_misuse"],
    turn: turn({
      id: "cal-tool-loop",
      user: "Install the dependencies.",
      reply: "I couldn't install them.",
      tools: Array.from({ length: 6 }, () => ({
        name: "shell",
        input: '{"command":"npm install"}',
        status: "completed",
        output: '{"exitCode":1,"stderr":"npm: command not found"}',
      })),
    }),
  },
  {
    issues: ["verbose"],
    turn: turn({
      id: "cal-verbose",
      user: "Is 17 prime?",
      reply: `Great question! Let's think about what a prime number is. A prime number is a natural number greater than 1 that has no positive divisors other than 1 and itself. To check 17, we can test divisibility by every prime up to its square root, which is about 4.12. So we check 2: 17 is odd, so not divisible by 2. Then 3: 1 + 7 = 8, not a multiple of 3. That covers every prime up to 4.12. Therefore, we can conclude with confidence that 17 is indeed a prime number. Prime numbers like 17 are fascinating and play an important role in cryptography, number theory and more! Let me know if you'd like to explore other numbers.`,
    }),
  },
  {
    issues: ["ignored_instruction"],
    turn: turn({
      id: "cal-ignored",
      user: "Summarise this article in one sentence, in French: The city council approved a new bike lane network on Tuesday after a two-year consultation.",
      reply:
        "The city council approved a new network of bike lanes on Tuesday. The decision followed a consultation that lasted two years.",
    }),
  },
  {
    issues: ["poor_error_handling"],
    turn: turn({
      id: "cal-error",
      user: "Back up my photos folder to the drive.",
      runStatus: "failed",
      runError: "ENOSPC: no space left on device",
      reply: "Error: ENOSPC: no space left on device, write",
    }),
  },
];
