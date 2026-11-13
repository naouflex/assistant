import * as SecureStore from "expo-secure-store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_AUTO_SPEAK_KEY,
  backgroundAutoSpeakEnabled,
  loadBackgroundAutoSpeak,
  resetBackgroundAutoSpeakForTests,
  saveBackgroundAutoSpeak,
} from "./voice-background";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
}));

beforeEach(() => {
  resetBackgroundAutoSpeakForTests();
  vi.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
  vi.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
});

describe("background auto-speak setting", () => {
  it("is off until chosen, and remembers the choice", async () => {
    await expect(loadBackgroundAutoSpeak()).resolves.toBe(false);
    await saveBackgroundAutoSpeak(true);
    expect(backgroundAutoSpeakEnabled()).toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(BACKGROUND_AUTO_SPEAK_KEY, "1");

    resetBackgroundAutoSpeakForTests();
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue("1");
    await expect(loadBackgroundAutoSpeak()).resolves.toBe(true);
  });

  it("goes back to the previous choice when saving fails", async () => {
    vi.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error("locked"));
    await expect(saveBackgroundAutoSpeak(true)).rejects.toThrow("locked");
    expect(backgroundAutoSpeakEnabled()).toBe(false);
  });
});
