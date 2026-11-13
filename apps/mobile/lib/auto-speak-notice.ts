import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { showAppNotice } from "./app-notice";
import { t } from "./i18n";

/** Set once the user has been told auto-speak failed; cleared when a reply is read again. */
export const AUTO_SPEAK_FAILURE_KEY = "atlas.voice.auto-speak-failure-noticed";

let noticed: boolean | undefined;

async function wasNoticed(): Promise<boolean> {
  if (noticed !== undefined) return noticed;
  noticed = (await SecureStore.getItemAsync(AUTO_SPEAK_FAILURE_KEY).catch(() => null)) === "1";
  return noticed;
}

/**
 * Auto-speak failed quietly before. Now the first failure says so, once, with a way to Voice
 * settings; later failures stay quiet until a reply is read aloud again, so a missing voice
 * never nags on every reply.
 */
export async function noticeAutoSpeakFailure(reason: "no-voice" | "failed"): Promise<void> {
  if (await wasNoticed()) return;
  noticed = true;
  void SecureStore.setItemAsync(AUTO_SPEAK_FAILURE_KEY, "1").catch(() => undefined);
  showAppNotice({
    tone: "warning",
    message:
      reason === "no-voice"
        ? t("Auto-speak is on, but no voice is set up.")
        : t("Could not read the reply aloud."),
    action: { label: t("Open Voice"), onPress: () => router.push("/voice") },
    durationMs: 8000,
  });
}

/** A reply was read aloud: the next failure is worth telling again. */
export async function clearAutoSpeakFailure(): Promise<void> {
  if (!(await wasNoticed())) return;
  noticed = false;
  await SecureStore.deleteItemAsync(AUTO_SPEAK_FAILURE_KEY).catch(() => undefined);
}

/** Test seam. */
export function resetAutoSpeakNoticeForTests(): void {
  noticed = undefined;
}
