import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

type Subscription = { remove(): void };
type AtlasPlaybackNative = {
  startPlayback?(title: string): Promise<boolean>;
  stopPlayback?(): Promise<void>;
  addListener?(event: "onPlaybackStop", listener: () => void): Subscription;
};

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<AtlasPlaybackNative>("AtlasNotifications")
    : null;

/** A short gap between queued replies must not tear the notification down and back up. */
export const PLAYBACK_RELEASE_DELAY_MS = 1500;

export type PlaybackKeeperDeps = {
  start(title: string): Promise<boolean>;
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
  let releaseTimer: unknown;
  let queue: Promise<unknown> = Promise.resolve();

  const serialized = (task: () => Promise<unknown>) => {
    queue = queue.then(task, task).catch(() => undefined);
    return queue;
  };

  const sync = () =>
    serialized(async () => {
      if (wanted && !held) {
        held = await deps.start(title).catch(() => false);
      } else if (!wanted && held) {
        held = false;
        await deps.stop().catch(() => undefined);
      }
    });

  return {
    /** Speaking (or paused mid-reply) holds the service; idle lets it go after a short grace. */
    update(active: boolean, nextTitle = ""): Promise<unknown> {
      if (active) {
        if (releaseTimer !== undefined) deps.clearTimer(releaseTimer);
        releaseTimer = undefined;
        title = nextTitle;
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
  start: async (title) =>
    typeof native?.startPlayback === "function" ? native.startPlayback(title) : false,
  stop: async () => {
    if (typeof native?.stopPlayback === "function") await native.stopPlayback();
  },
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
});

/** Keeps read-aloud playing in the background on Android; a no-op elsewhere or on older builds. */
export function keepPlaybackInBackground(active: boolean, title?: string): void {
  if (!native) return;
  void keeper.update(active, title);
}

export function releasePlaybackBackground(): void {
  if (!native) return;
  void keeper.release();
}

/** The notification's Stop button, a headset button, or the lock-screen control. */
export function onPlaybackStopRequested(listener: () => void): () => void {
  if (typeof native?.addListener !== "function") return () => undefined;
  const subscription = native.addListener("onPlaybackStop", listener);
  return () => subscription.remove();
}
