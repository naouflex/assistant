import { describe, expect, it, vi } from "vitest";
import {
  createConnectionNotice,
  FIRST_PROBE_MS,
  MAX_PROBE_MS,
  OFFLINE_GRACE_MS,
} from "./connection-notice";

function harness() {
  let reachable = true;
  let active = true;
  const listeners = new Set<() => void>();
  const timers: Array<{ run: () => void; ms: number; at: number; cleared: boolean }> = [];
  let now = 0;
  let nextId = 1;
  const deps = {
    isReachable: () => reachable,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    probe: vi.fn(async () => true),
    showOffline: vi.fn(() => nextId++),
    showBackOnline: vi.fn(() => nextId++),
    dismiss: vi.fn(),
    isActive: () => active,
    setTimer: (run: () => void, ms: number) => {
      const timer = { run, ms, at: now + ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer: unknown) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = timers
        .filter((timer) => !timer.cleared && timer.at <= until)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cleared = true;
      now = due.at;
      due.run();
    }
    now = until;
  };
  const set = (next: boolean) => {
    reachable = next;
    for (const listener of [...listeners]) listener();
  };
  const watcher = createConnectionNotice(deps);
  return {
    deps,
    watcher,
    advance,
    set,
    background: (value: boolean) => {
      active = !value;
    },
    probeDelays: () => timers.filter((timer) => timer.ms !== OFFLINE_GRACE_MS).map((t) => t.ms),
  };
}

describe("connection notice", () => {
  it("stays quiet through a short blip", () => {
    const { deps, advance, set } = harness();
    set(false);
    advance(OFFLINE_GRACE_MS - 1);
    set(true);
    advance(OFFLINE_GRACE_MS * 2);
    expect(deps.showOffline).not.toHaveBeenCalled();
    expect(deps.showBackOnline).not.toHaveBeenCalled();
  });

  it("says Atlas is unreachable, probes with backoff, then says it is back", () => {
    const { deps, advance, set, probeDelays } = harness();
    set(false);
    advance(OFFLINE_GRACE_MS);
    expect(deps.showOffline).toHaveBeenCalledOnce();

    advance(FIRST_PROBE_MS + FIRST_PROBE_MS * 2 + FIRST_PROBE_MS * 4 + MAX_PROBE_MS * 2);
    expect(deps.probe.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...probeDelays())).toBe(MAX_PROBE_MS);

    set(true);
    expect(deps.dismiss).toHaveBeenCalledWith(1);
    expect(deps.showBackOnline).toHaveBeenCalledOnce();
    const probes = deps.probe.mock.calls.length;
    advance(MAX_PROBE_MS * 3);
    expect(deps.probe).toHaveBeenCalledTimes(probes);
  });

  it("does not probe in the background, and checks at once on return", () => {
    const { deps, watcher, advance, set, background } = harness();
    background(true);
    set(false);
    advance(MAX_PROBE_MS * 3);
    expect(deps.probe).not.toHaveBeenCalled();
    background(false);
    watcher.resumed();
    expect(deps.probe).toHaveBeenCalledOnce();
  });

  it("clears its notice when disposed", () => {
    const { deps, watcher, advance, set } = harness();
    set(false);
    advance(OFFLINE_GRACE_MS);
    watcher.dispose();
    expect(deps.dismiss).toHaveBeenCalledWith(1);
  });
});
