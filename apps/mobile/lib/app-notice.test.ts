import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_NOTICE_MS,
  dismissAppNotice,
  getAppNotice,
  showAppNotice,
  subscribeAppNotice,
} from "./app-notice";

afterEach(() => {
  dismissAppNotice();
  vi.useRealTimers();
});

describe("app notice", () => {
  it("shows one notice at a time and dismisses it after a while", () => {
    vi.useFakeTimers();
    const seen = vi.fn();
    const unsubscribe = subscribeAppNotice(seen);
    const first = showAppNotice({ message: "First" });
    showAppNotice({ message: "Second", tone: "warning" });
    expect(getAppNotice()).toMatchObject({ message: "Second", tone: "warning" });
    // The replaced notice's id no longer dismisses the one showing.
    dismissAppNotice(first);
    expect(getAppNotice()?.message).toBe("Second");

    vi.advanceTimersByTime(DEFAULT_NOTICE_MS);
    expect(getAppNotice()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("keeps a notice with no duration until it is dismissed", () => {
    vi.useFakeTimers();
    const onPress = vi.fn();
    const id = showAppNotice({ message: "Stay", durationMs: 0, action: { label: "Go", onPress } });
    vi.advanceTimersByTime(DEFAULT_NOTICE_MS * 10);
    expect(getAppNotice()).toMatchObject({ id, action: { label: "Go" } });
    dismissAppNotice(id);
    expect(getAppNotice()).toBeNull();
  });
});
