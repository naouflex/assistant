import { PLAYBACK_ECHO_RATIO, spokenMemory } from "./echo.js";

export { PLAYBACK_ECHO_RATIO };

/** The only one-word turns worth cutting a reply short for. */
const INTERRUPT_WORDS = new Set(["stop", "wait", "hold on", "pause", "no"]);

/**
 * How long an interim phrase must stand before it cuts playback.
 * The final transcript arrives later, after the reply has already finished.
 */
export const INTERIM_BARGE_IN_MS = 300;

/** A sentence, or one interruption word, that is not the reply leaking back into the mic. */
export function isCallBargeIn(text: string): boolean {
  if (spokenMemory.isPlaybackEcho(text)) return false;
  const cleaned = cleanWords(text);
  return cleaned.includes(" ") || INTERRUPT_WORDS.has(cleaned);
}

/** An interim is revised word by word, so one stray word never cuts playback. */
export function isInterimCallBargeIn(text: string): boolean {
  const cleaned = cleanWords(text);
  if (spokenMemory.isPlaybackEcho(text)) return false;
  return cleaned.includes(" ") || INTERRUPT_WORDS.has(cleaned);
}

function cleanWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Counts down an interim phrase heard over a reply: one that stands for
 * INTERIM_BARGE_IN_MS calls `onBargeIn`, and anything that no longer qualifies resets it.
 */
export function createInterimBargeIn(onBargeIn: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    hear(text: string): void {
      if (!isInterimCallBargeIn(text)) {
        clear();
        return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        onBargeIn();
      }, INTERIM_BARGE_IN_MS);
    },
    clear,
  };
}
