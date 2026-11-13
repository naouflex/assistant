import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

type Subscription = { remove(): void };
/** "granted", "delayed" (a call holds the audio; "resumed" follows), or "failed". */
export type SpeechFocusGrant = "granted" | "delayed" | "failed";
/** A call or another app took the audio for now, gave it back, or took it for good. */
export type SpeechFocusChange = "interrupted" | "resumed" | "lost";
type AtlasPlaybackNative = {
  startPlayback?(title: string): Promise<boolean>;
  startPlaybackWithText?(title: string, text: string): Promise<boolean>;
  updatePlayback?(title: string, text: string): Promise<boolean>;
  stopPlayback?(): Promise<void>;
  acquireSpeechFocus?(): Promise<SpeechFocusGrant>;
  releaseSpeechFocus?(): Promise<void>;
  addListener?(event: "onPlaybackStop", listener: () => void): Subscription;
  addListener?(
    event: "onSpeechFocus",
    listener: (event: { state: SpeechFocusChange }) => void,
  ): Subscription;
};

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<AtlasPlaybackNative>("AtlasNotifications")
    : null;

/** A short gap between queued replies must not tear the notification down and back up. */
export const PLAYBACK_RELEASE_DELAY_MS = 1500;

export type PlaybackKeeperDeps = {
  start(title: string, text: string): Promise<boolean>;
  /** Changes a held notification's lines in place. Optional: older builds cannot. */
  update?(title: string, text: string): Promise<unknown>;
  stop(): Promise<void>;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
};

/**
 * Holds a media-playback foreground service for as long as a reply is being read aloud, so
 * Android keeps the app (and its audio) running with the screen off or another app in front.
 * Start and stop are serialized: a stop issued while a start is in flight is not overtaken.
 */
export function createPlaybackKeeper(deps: PlaybackKeeperDeps) {
  let wanted = false;
  let held = false;
  let title = "";
  let text = "";
  let shown = { title: "", text: "" };
  let releaseTimer: unknown;
  let queue: Promise<unknown> = Promise.resolve();

  const serialized = (task: () => Promise<unknown>) => {
    queue = queue.then(task, task).catch(() => undefined);
    return queue;
  };

  const sync = () =>
    serialized(async () => {
      if (wanted && !held) {
        shown = { title, text };
        held = await deps.start(title, text).catch(() => false);
      } else if (wanted && held && (shown.title !== title || shown.text !== text)) {
        // Starting the service again from the background is refused; edit the notification.
        shown = { title, text };
        await deps.update?.(title, text).catch(() => undefined);
      } else if (!wanted && held) {
        held = false;
        await deps.stop().catch(() => undefined);
      }
    });

  return {
    /** Speaking (or paused mid-reply) holds the service; idle lets it go after a short grace. */
    update(active: boolean, nextTitle = "", nextText = ""): Promise<unknown> {
      if (active) {
        if (releaseTimer !== undefined) deps.clearTimer(releaseTimer);
        releaseTimer = undefined;
        title = nextTitle;
        text = nextText;
        wanted = true;
        return sync();
      }
      if (!wanted || releaseTimer !== undefined) return queue;
      releaseTimer = deps.setTimer(() => {
        releaseTimer = undefined;
        wanted = false;
        void sync();
      }, PLAYBACK_RELEASE_DELAY_MS);
      return queue;
    },
    /** Lets the service go now, e.g. when the user tapped Stop. */
    release(): Promise<unknown> {
      if (releaseTimer !== undefined) deps.clearTimer(releaseTimer);
      releaseTimer = undefined;
      wanted = false;
      return sync();
    },
    get held() {
      return held;
    },
  };
}

const keeper = createPlaybackKeeper({
  start: async (title, text) => {
    if (typeof native?.startPlaybackWithText === "function") {
      return native.startPlaybackWithText(title, text);
    }
    return typeof native?.startPlayback === "function" ? native.startPlayback(title) : false;
  },
  update: async (title, text) => {
    if (typeof native?.updatePlayback === "function") await native.updatePlayback(title, text);
  },
  stop: async () => {
    if (typeof native?.stopPlayback === "function") await native.stopPlayback();
  },
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
});

/** Why the app should stay alive in the background: a reply being read, or one on its way. */
type KeepAlive = {
  speaking?: { title: string; text: string };
  waiting?: { title: string; text: string };
};
const keepAlive: KeepAlive = {};

function syncKeepAlive(): void {
  if (!native) return;
  // Reading wins the notification; waiting fills the gaps between streamed sentences.
  const shown = keepAlive.speaking ?? keepAlive.waiting;
  void keeper.update(shown !== undefined, shown?.title ?? "", shown?.text ?? "");
}

/** Keeps read-aloud playing in the background on Android; a no-op elsewhere or on older builds. */
export function keepPlaybackInBackground(active: boolean, title?: string, text?: string): void {
  keepAlive.speaking = active ? { title: title ?? "", text: text ?? "" } : undefined;
  syncKeepAlive();
}

/**
 * Keeps the app alive while a reply that will be read aloud is still being written, so it is
 * heard with the app in the background. Null stops waiting.
 */
export function keepWaitingForReply(waiting: { title: string; text: string } | null): void {
  keepAlive.waiting = waiting ?? undefined;
  syncKeepAlive();
}

export function releasePlaybackBackground(): void {
  if (!native) return;
  keepAlive.speaking = undefined;
  keepAlive.waiting = undefined;
  void keeper.release();
}

/** The notification's Stop button, a headset button, or the lock-screen control. */
export function onPlaybackStopRequested(listener: () => void): () => void {
  if (typeof native?.addListener !== "function") return () => undefined;
  const subscription = native.addListener("onPlaybackStop", listener);
  return () => subscription.remove();
}

/** True when this build can duck other audio and pause for calls on its own. */
export function speechFocusSupported(): boolean {
  return typeof native?.acquireSpeechFocus === "function";
}

/** Asks for the audio for a reply: other apps duck, and a call pauses the reply. */
export async function acquireSpeechFocus(): Promise<SpeechFocusGrant> {
  if (typeof native?.acquireSpeechFocus !== "function") return "failed";
  return native.acquireSpeechFocus().catch(() => "failed" as const);
}

export async function releaseSpeechFocus(): Promise<void> {
  if (typeof native?.releaseSpeechFocus === "function") {
    await native.releaseSpeechFocus().catch(() => undefined);
  }
}

export function onSpeechFocusChange(listener: (change: SpeechFocusChange) => void): () => void {
  if (typeof native?.addListener !== "function") return () => undefined;
  const subscription = native.addListener("onSpeechFocus", (event) => listener(event.state));
  return () => subscription.remove();
}
