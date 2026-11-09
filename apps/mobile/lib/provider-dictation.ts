/**
 * Speech to text through the connected voice provider: record a clip on the device,
 * then let the server transcribe it. Shared by calls and composer hold-to-talk.
 */

import { File } from "expo-file-system";
import { captureApiRequestContext, rpc } from "./api";
import { t } from "./i18n";
import { errorText, voiceAccountErrorText } from "./user-error";

export type VoiceClip = { base64: string; mimeType: string };

/** True when a voice provider is ready and can turn audio into text. */
export async function providerTranscribes(): Promise<boolean> {
  try {
    const status = await rpc("voice/status");
    return Boolean(status.ready && status.transcribe);
  } catch {
    return false;
  }
}

export async function transcribeVoiceClip(
  clip: VoiceClip,
  signal?: AbortSignal,
): Promise<{ text: string } | { error: string }> {
  const { apiBase, headers } = await captureApiRequestContext();
  const res = await fetch(`${apiBase}/api/voice/transcribe`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "atlas://", ...headers },
    body: JSON.stringify({ audioBase64: clip.base64, mimeType: clip.mimeType }),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
    code?: string;
  };
  if (!res.ok) {
    return {
      error:
        voiceAccountErrorText(body) ?? errorText(body.error ?? "", t("Could not transcribe that.")),
    };
  }
  return { text: body.text ?? "" };
}

export type HeldRecording = {
  /** Stops recording and returns the clip, or null when nothing was captured. */
  finish(): Promise<VoiceClip | null>;
  cancel(): void;
};

/** Starts recording until `finish` or `cancel`; null when the microphone is not allowed. */
export async function startHeldRecording(): Promise<HeldRecording | null> {
  const { AudioModule, RecordingPresets, setAudioModeAsync } = await import("expo-audio");
  const permission = await AudioModule.requestRecordingPermissionsAsync();
  if (!permission.granted) return null;
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
  let done = false;
  const release = async () => {
    recorder.release();
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  };
  try {
    await recorder.prepareToRecordAsync();
    recorder.record();
  } catch (error) {
    await release();
    throw error;
  }
  const stop = async () => {
    await recorder.stop().catch(() => undefined);
    return recorder.uri;
  };
  return {
    async finish() {
      if (done) return null;
      done = true;
      const uri = await stop();
      await release();
      if (!uri) return null;
      const file = new File(uri);
      try {
        return { base64: await file.base64(), mimeType: "audio/m4a" };
      } finally {
        deleteQuietly(uri);
      }
    },
    cancel() {
      if (done) return;
      done = true;
      void stop().then(async (uri) => {
        await release();
        deleteQuietly(uri);
      });
    },
  };
}

export function deleteQuietly(uri: string | null): void {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // The clip is disposable; a leftover in the cache is fine.
  }
}
