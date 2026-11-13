import * as SecureStore from "expo-secure-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dismissAppNotice, getAppNotice } from "./app-notice";
import {
  AUTO_SPEAK_FAILURE_KEY,
  clearAutoSpeakFailure,
  noticeAutoSpeakFailure,
  resetAutoSpeakNoticeForTests,
} from "./auto-speak-notice";

const push = vi.hoisted(() => vi.fn());
vi.mock("expo-router", () => ({ router: { push } }));
vi.mock("expo-localization", () => ({ getLocales: () => [{ languageTag: "en-US" }] }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

beforeEach(() => {
  resetAutoSpeakNoticeForTests();
  dismissAppNotice();
  vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  vi.mocked(SecureStore.setItemAsync).mockClear();
});

describe("auto-speak failure notice", () => {
  it("says so once, with a way to Voice settings", async () => {
    await noticeAutoSpeakFailure("no-voice");
    const notice = getAppNotice();
    expect(notice).toMatchObject({
      tone: "warning",
      message: "Auto-speak is on, but no voice is set up.",
      action: { label: "Open Voice" },
    });
    notice?.action?.onPress();
    expect(push).toHaveBeenCalledWith("/voice");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(AUTO_SPEAK_FAILURE_KEY, "1");

    dismissAppNotice();
    await noticeAutoSpeakFailure("failed");
    expect(getAppNotice()).toBeNull();
  });

  it("stays quiet when told before, and tells again after a reply was read", async () => {
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("1");
    await noticeAutoSpeakFailure("failed");
    expect(getAppNotice()).toBeNull();

    await clearAutoSpeakFailure();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(AUTO_SPEAK_FAILURE_KEY);
    await noticeAutoSpeakFailure("failed");
    expect(getAppNotice()?.message).toBe("Could not read the reply aloud.");
  });
});
