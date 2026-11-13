import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  startPlayback: vi.fn(async (_title: string) => true),
  stopPlayback: vi.fn(async () => undefined),
  listeners: [] as Array<() => void>,
  addListener: vi.fn((_event: string, listener: () => void) => {
    native.listeners.push(listener);
    return { remove: () => native.listeners.splice(native.listeners.indexOf(listener), 1) };
  }),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => native }));

import {
  createPlaybackKeeper,
  onPlaybackStopRequested,
  PLAYBACK_RELEASE_DELAY_MS,
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
    expect(deps.start).toHaveBeenCalledWith("Strike");
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
