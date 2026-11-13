import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";

export const BACKGROUND_AUTO_SPEAK_KEY = "atlas.voice.background-auto-speak";

// Off until chosen: reading replies aloud with the app closed keeps a notification up meanwhile.
let enabled = false;
let loaded: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Whether a bot with auto-speak reads its replies while Atlas is in the background. */
export function loadBackgroundAutoSpeak(): Promise<boolean> {
  loaded ??= SecureStore.getItemAsync(BACKGROUND_AUTO_SPEAK_KEY)
    .then((stored) => {
      enabled = stored === "1";
      emit();
      return enabled;
    })
    .catch(() => enabled);
  return loaded;
}

export async function saveBackgroundAutoSpeak(on: boolean): Promise<void> {
  const previous = enabled;
  enabled = on;
  loaded = Promise.resolve(on);
  emit();
  try {
    await SecureStore.setItemAsync(BACKGROUND_AUTO_SPEAK_KEY, on ? "1" : "0");
  } catch (error) {
    enabled = previous;
    loaded = Promise.resolve(previous);
    emit();
    throw error;
  }
}

export function backgroundAutoSpeakEnabled(): boolean {
  return enabled;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void loadBackgroundAutoSpeak();
  return () => listeners.delete(listener);
}

export function useBackgroundAutoSpeak(): boolean {
  return useSyncExternalStore(subscribe, backgroundAutoSpeakEnabled, backgroundAutoSpeakEnabled);
}

/** Test seam: forget the cached choice. */
export function resetBackgroundAutoSpeakForTests(): void {
  enabled = false;
  loaded = null;
}
