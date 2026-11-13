import { narrateTool, toUtterances } from "@atlas/core";

/** Matches the synthesis request limit, so a chunk is never split again on its way out. */
const MAX_CHUNK_CHARS = 320;

/** Drops a code fence that has not closed yet: its body would be read as prose. */
function withoutOpenFence(text: string): string {
  const fences = [...text.matchAll(/^\s{0,3}(```|~~~)/gm)];
  if (fences.length % 2 === 0) return text;
  const open = fences.at(-1);
  return open?.index === undefined ? text : text.slice(0, open.index);
}

/** The reply's sentences as a voice would read them, the still-growing last one left out. */
export function speakableSentences(text: string, final: boolean): string[] {
  const sentences = toUtterances(final ? text : withoutOpenFence(text), { minChars: 0 });
  // Until the reply ends, its last sentence may still be growing ("It costs 3" → "…3.50 €").
  return final ? sentences : sentences.slice(0, -1);
}

/** Groups sentences into chunks of up to one synthesis request each, in order. */
export function chunkSentences(sentences: readonly string[], maxChars = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + 1 + sentence.length <= maxChars) {
      chunks[chunks.length - 1] = `${last} ${sentence}`;
    } else {
      chunks.push(sentence);
    }
  }
  return chunks;
}

/**
 * Reads a reply aloud while it streams: each call hands back only the sentences not spoken yet.
 *
 * Spoken sentences are matched against the newest text in order rather than by character
 * offset, so text the model withdrew mid-run (a reset) and the final message, which replaces the
 * live one under a new id, both continue where the voice left off instead of starting over.
 */
export class SpeechStreamTracker {
  private spoken: string[] = [];

  /** Whether any of this reply has been read aloud yet. */
  get started(): boolean {
    return this.spoken.length > 0;
  }

  /** New sentences to read from `text`, the reply so far; `final` once it is complete. */
  take(text: string, final: boolean): string[] {
    const sentences = speakableSentences(text, final);
    let next = 0;
    for (const said of this.spoken) {
      const at = sentences.indexOf(said, next);
      if (at !== -1) next = at + 1;
    }
    const fresh = sentences.slice(next);
    this.spoken.push(...fresh);
    return fresh;
  }

  reset(): void {
    this.spoken = [];
  }
}

/** The step labels a live message shows ("Web search"), oldest first. */
export function liveStepLabels(
  blocks: ReadonlyArray<{ kind: string; steps?: ReadonlyArray<{ label: string }> }>,
): string[] {
  return blocks.flatMap((block) =>
    block.kind === "steps" ? (block.steps ?? []).map((step) => step.label) : [],
  );
}

/**
 * One spoken "working on it" line for a run that is busy with tools before it has said anything.
 * English names what the bot is doing ("searching the web"); other languages keep the short line,
 * since step names are English. A tool without a plain-words verb is not read out by name.
 */
export function workingNarration(
  stepLabels: readonly string[],
  locale: string,
  workingOnIt: string,
): string {
  if (locale !== "en") return workingOnIt;
  for (const label of stepLabels) {
    const tool = label.trim().toLowerCase().replace(/\s+/g, "_");
    const phrase = narrateTool(tool);
    // narrateTool falls back to "running <tool name>", which is the indicator itself.
    if (phrase && phrase !== `running ${tool.slice(0, 40)}`) {
      return `${workingOnIt.replace(/[.!]$/, "")}, ${phrase}.`;
    }
  }
  return workingOnIt;
}

/** How long a run may work silently before the voice says it is on it. */
export const WORKING_NARRATION_DELAY_MS = 4000;

export type ReplySpeakerDeps = {
  /** Adds chunks to what this reply is saying; resolves false when no voice is set up. */
  append(chunks: string[], owner: symbol): Promise<boolean>;
  /** Reads a finished reply whole (the server may summarize it). */
  speakWhole(text: string): Promise<boolean>;
  createOwner(): symbol;
  /** The narration line for the steps so far. */
  narration(stepLabels: readonly string[]): string;
  /** Every outcome, for telling the user once when the voice could not speak. */
  onOutcome(outcome: { spoken: boolean } | { error: unknown }): void;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
};

/**
 * Speaks one bot's replies as they stream: finished sentences while the run is still going, a
 * single "working on it" line if it is busy with tools first, and only the rest once the final
 * message lands. A reply that never streamed is read whole, so a long one can be summarized.
 */
export function createReplySpeaker(deps: ReplySpeakerDeps) {
  let runId: string | null = null;
  let owner: symbol | null = null;
  let tracker = new SpeechStreamTracker();
  let narrated = false;
  let steps: readonly string[] = [];
  let narrationTimer: unknown;

  const report = (result: Promise<boolean>) => {
    void result.then(
      (spoken) => deps.onOutcome({ spoken }),
      (error: unknown) => deps.onOutcome({ error }),
    );
  };

  const cancelNarration = () => {
    if (narrationTimer !== undefined) deps.clearTimer(narrationTimer);
    narrationTimer = undefined;
  };

  const begin = (nextRunId: string) => {
    cancelNarration();
    runId = nextRunId;
    owner = deps.createOwner();
    tracker = new SpeechStreamTracker();
    narrated = false;
    steps = [];
    narrationTimer = deps.setTimer(() => {
      narrationTimer = undefined;
      if (narrated || tracker.started || steps.length === 0 || !owner) return;
      narrated = true;
      report(deps.append([deps.narration(steps)], owner));
    }, WORKING_NARRATION_DELAY_MS);
  };

  return {
    /** The reply so far, while its run is in progress and the voice may speak. */
    live(input: { runId: string; text: string; stepLabels: readonly string[] }): void {
      if (input.runId !== runId) begin(input.runId);
      steps = input.stepLabels;
      const fresh = tracker.take(input.text, false);
      if (fresh.length === 0 || !owner) return;
      // The reply is talking; a "working on it" line now would only interrupt it.
      narrated = true;
      cancelNarration();
      report(deps.append(chunkSentences(fresh), owner));
    },
    /** The finished reply. Speaks what streaming has not said yet, or all of it. */
    finish(text: string): void {
      cancelNarration();
      const streamed = tracker.started && owner !== null;
      if (streamed && owner) {
        const rest = tracker.take(text, true);
        if (rest.length > 0) report(deps.append(chunkSentences(rest), owner));
      } else {
        report(deps.speakWhole(text));
      }
      runId = null;
      owner = null;
      tracker = new SpeechStreamTracker();
    },
    /** The run ended without a reply to read, or the chat changed. */
    abandon(): void {
      cancelNarration();
      runId = null;
      owner = null;
      tracker = new SpeechStreamTracker();
    },
    get streaming(): boolean {
      return tracker.started;
    },
  };
}
