import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  startPlayback: vi.fn(async (_title: string) => true),
  startPlaybackWithText: vi.fn(async (_title: string, _text: string) => true),
  updatePlayback: vi.fn(async (_title: string, _text: string) => undefined),
  stopPlayback: vi.fn(async () => undefined),
  acquireSpeechFocus: vi.fn(async () => "granted"),
  releaseSpeechFocus: vi.fn(async () => undefined),
  listeners: [] as Array<() => void>,
  focusListeners: [] as Array<(event: { state: string }) => void>,
  addListener: vi.fn((event: string, listener: (payload: { state: string }) => void) => {
    if (event === "onSpeechFocus") {
      native.focusListeners.push(listener);
      return { remove: () => undefined };
    }
    const stop = () => listener({ state: "" });
    native.listeners.push(stop);
    return { remove: () => native.listeners.splice(native.listeners.indexOf(stop), 1) };
  }),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => native }));

import {
  acquireSpeechFocus,
  createPlaybackKeeper,
  keepPlaybackInBackground,
  keepWaitingForReply,
  onPlaybackStopRequested,
  onSpeechFocusChange,
  PLAYBACK_RELEASE_DELAY_MS,
  releasePlaybackBackground,
  speechFocusSupported,
} from "./playback-background";

function fakeKeeper() {
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const deps = {
    start: vi.fn(async (_title: string) => true),
    stop: vi.fn(async () => undefined),
    setTimer: (run: () => void, ms: number) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer: unknown) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  };
  const fire = () => {
    for (const timer of timers.splice(0)) if (!timer.cleared) timer.run();
  };
  return { keeper: createPlaybackKeeper(deps), deps, timers, fire };
}

describe("background playback keeper", () => {
  it("holds the service while a reply plays and lets it go after a grace period", async () => {
    const { keeper, deps, timers, fire } = fakeKeeper();
    await keeper.update(true, "Strike");
    expect(deps.start).toHaveBeenCalledWith("Strike", "");
    expect(keeper.held).toBe(true);

    await keeper.update(false);
    expect(deps.stop).not.toHaveBeenCalled();
    expect(timers[0]?.ms).toBe(PLAYBACK_RELEASE_DELAY_MS);
    fire();
    await keeper.update(false);
    expect(deps.stop).toHaveBeenCalledOnce();
    expect(keeper.held).toBe(false);
  });

  it("keeps one notification across the gap between queued replies", async () => {
    const { keeper, deps, fire } = fakeKeeper();
    await keeper.update(true, "Ada");
    await keeper.update(false);
    await keeper.update(true, "Ada");
    fire();
    await keeper.update(true, "Ada");
    expect(deps.start).toHaveBeenCalledOnce();
    expect(deps.stop).not.toHaveBeenCalled();
  });

  it("releases immediately on Stop", async () => {
    const { keeper, deps } = fakeKeeper();
    await keeper.update(true);
    await keeper.release();
    expect(deps.stop).toHaveBeenCalledOnce();
    expect(keeper.held).toBe(false);
  });

  it("retries on the next reply when the service could not start", async () => {
    const { keeper, deps } = fakeKeeper();
    deps.start.mockResolvedValueOnce(false);
    await keeper.update(true);
    expect(keeper.held).toBe(false);
    await keeper.update(true);
    expect(deps.start).toHaveBeenCalledTimes(2);
    expect(keeper.held).toBe(true);
  });

  it("forwards the notification's Stop to the app", () => {
    const stop = vi.fn();
    const unsubscribe = onPlaybackStopRequested(stop);
    for (const listener of [...native.listeners]) listener();
    expect(stop).toHaveBeenCalledOnce();
    unsubscribe();
    expect(native.listeners).toHaveLength(0);
  });
});

describe("notification lines", () => {
  it("edits the held notification in place instead of starting the service again", async () => {
    const { keeper, deps } = fakeKeeper();
    const update = vi.fn(async (_title: string, _text: string) => undefined);
    const withUpdate = createPlaybackKeeper({ ...deps, update });
    await withUpdate.update(true, "Ada", "Waiting for the reply");
    await withUpdate.update(true, "Ada", "");
    await withUpdate.update(true, "Ada", "");
    expect(deps.start).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith("Ada", "");
    expect(keeper.held).toBe(false);
  });

  it("stays up while a reply is on its way, and while it is read", async () => {
    vi.useFakeTimers();
    try {
      native.startPlaybackWithText.mockClear();
      native.updatePlayback.mockClear();
      native.stopPlayback.mockClear();
      keepWaitingForReply({ title: "Ada", text: "Waiting for the reply" });
      await vi.waitFor(() =>
        expect(native.startPlaybackWithText).toHaveBeenCalledWith("Ada", "Waiting for the reply"),
      );
      keepPlaybackInBackground(true, "Ada");
      await vi.waitFor(() => expect(native.updatePlayback).toHaveBeenCalledWith("Ada", ""));
      // Between streamed sentences the wait keeps it up.
      keepPlaybackInBackground(false);
      await vi.advanceTimersByTimeAsync(PLAYBACK_RELEASE_DELAY_MS * 2);
      expect(native.stopPlayback).not.toHaveBeenCalled();

      keepWaitingForReply(null);
      await vi.advanceTimersByTimeAsync(PLAYBACK_RELEASE_DELAY_MS);
      expect(native.stopPlayback).toHaveBeenCalledOnce();
      expect(native.startPlaybackWithText).toHaveBeenCalledOnce();
    } finally {
      releasePlaybackBackground();
      vi.useRealTimers();
    }
  });
});

describe("speech audio focus", () => {
  it("passes the grant and focus changes through from the native module", async () => {
    expect(speechFocusSupported()).toBe(true);
    await expect(acquireSpeechFocus()).resolves.toBe("granted");
    native.acquireSpeechFocus.mockRejectedValueOnce(new Error("no"));
    await expect(acquireSpeechFocus()).resolves.toBe("failed");

    const changes: string[] = [];
    onSpeechFocusChange((change) => changes.push(change));
    for (const listener of native.focusListeners) listener({ state: "interrupted" });
    for (const listener of native.focusListeners) listener({ state: "resumed" });
    expect(changes).toEqual(["interrupted", "resumed"]);
  });
});
