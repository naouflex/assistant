import type {
  AdapterContext,
  AdapterDescriptor,
  SpeechClip,
  VoiceCapabilities,
  VoiceInfo,
  VoiceProvider,
  VoiceSynthesizeRequest,
  VoiceTranscribeRequest,
  VoiceVerifyResult,
} from "@atlas/adapter-kit";
import {
  DEFAULT_OPENROUTER_FISH_VOICE_ID,
  DEFAULT_OPENROUTER_STT_MODEL,
  DEFAULT_OPENROUTER_TTS_MODEL,
  OPENROUTER_DEFAULT_VOICE_ID,
  OPENROUTER_VOICE_PROVIDER_ID,
} from "@atlas/contracts";
import { openRouterReferer } from "./openrouter-usage.js";
import {
  readVoiceAudio,
  readVoiceJson,
  readVoiceText,
  speechUploadName,
  voiceDeadline,
  voiceHttpError,
  voiceRequestError,
  voiceUnreachable,
} from "./voice-http.js";

export { DEFAULT_OPENROUTER_STT_MODEL, DEFAULT_OPENROUTER_TTS_MODEL, OPENROUTER_VOICE_PROVIDER_ID };

const API = "https://openrouter.ai/api/v1";
const PROVIDER_NAME = "OpenRouter";
const MAX_MODEL_ID_LENGTH = 200;
const MAX_LISTED_VOICES = 500;
/** Saved voice ids are capped where the call stores them. */
const MAX_VOICE_ID_LENGTH = 120;
const MODEL_ID_PATTERN = /^[\w.:/@+-]+$/;
/** Visible ASCII only, so a key can never break the Authorization header. */
const API_KEY_PATTERN = /^[\x21-\x7e]+$/;
const MAX_SERVER_DETAIL_LENGTH = 160;
/**
 * A model that lists no voices still has to be selectable. For providers whose default
 * is stable when omitted, speech omits this id. Fish Audio on OpenRouter does not: each
 * request needs a voice id or the speaker drifts between utterances.
 */
export { DEFAULT_OPENROUTER_FISH_VOICE_ID, OPENROUTER_DEFAULT_VOICE_ID };

function isFishOpenRouterTtsModel(modelId: string): boolean {
  return modelId.startsWith("fish-audio/");
}

/** Voice field for /audio/speech, or undefined when the provider accepts omitting voice. */
function openRouterSpeechVoice(voiceId: string, ttsModel: string): string | undefined {
  const voice = voiceId.trim();
  if (voice && voice !== OPENROUTER_DEFAULT_VOICE_ID) return voice;
  if (isFishOpenRouterTtsModel(ttsModel)) return DEFAULT_OPENROUTER_FISH_VOICE_ID;
  return undefined;
}

/** What the encrypted voice secret holds for an OpenRouter key. */
export interface OpenRouterVoiceSecret {
  kind: "openrouter";
  apiKey: string;
  ttsModel: string;
  sttModel: string;
}

function modelIdOrDefault(value: string | undefined, fallback: string, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return fallback;
  if (trimmed.length > MAX_MODEL_ID_LENGTH || !MODEL_ID_PATTERN.test(trimmed)) {
    throw new Error(`${label} model id is not valid.`);
  }
  return trimmed;
}

/**
 * Validate the connection form and return the secret plaintext to store. A blank key
 * or blank model keeps the previous value, so replacing a key does not wipe the models.
 */
export function serializeOpenRouterVoiceSecret(
  input: { apiKey?: string; ttsModel?: string; sttModel?: string },
  previousPlaintext?: string,
): string {
  const previous = previousPlaintext ? tryParseSecret(previousPlaintext) : undefined;
  const apiKey = input.apiKey?.trim() || previous?.apiKey || "";
  if (apiKey.length < 8) throw new Error("Enter an API key.");
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new Error("That API key has characters a key cannot contain.");
  }
  const secret: OpenRouterVoiceSecret = {
    kind: "openrouter",
    apiKey,
    ttsModel: modelIdOrDefault(
      input.ttsModel || previous?.ttsModel,
      DEFAULT_OPENROUTER_TTS_MODEL,
      "Speech",
    ),
    sttModel: modelIdOrDefault(
      input.sttModel || previous?.sttModel,
      DEFAULT_OPENROUTER_STT_MODEL,
      "Transcription",
    ),
  };
  return JSON.stringify(secret);
}

function tryParseSecret(plaintext: string): OpenRouterVoiceSecret | undefined {
  try {
    return parseOpenRouterVoiceSecret(plaintext);
  } catch {
    return undefined;
  }
}

export function parseOpenRouterVoiceSecret(plaintext: string): OpenRouterVoiceSecret {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("Saved OpenRouter voice settings are unreadable. Connect OpenRouter again.");
  }
  const record = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  if (record.kind !== "openrouter" || typeof record.apiKey !== "string" || !record.apiKey) {
    throw new Error("Saved OpenRouter voice settings are unreadable. Connect OpenRouter again.");
  }
  return {
    kind: "openrouter",
    apiKey: record.apiKey,
    ttsModel:
      typeof record.ttsModel === "string" && record.ttsModel
        ? record.ttsModel
        : DEFAULT_OPENROUTER_TTS_MODEL,
    sttModel:
      typeof record.sttModel === "string" && record.sttModel
        ? record.sttModel
        : DEFAULT_OPENROUTER_STT_MODEL,
  };
}

/** The non-secret part of a saved connection. Undefined when the secret is unreadable. */
export interface OpenRouterVoiceServer {
  endpoint: string;
  ttsModel: string;
  sttModel: string;
}

export function openRouterVoiceServer(plaintext: string): OpenRouterVoiceServer | undefined {
  const secret = tryParseSecret(plaintext);
  if (!secret) return undefined;
  return { endpoint: "", ttsModel: secret.ttsModel, sttModel: secret.sttModel };
}

function headers(apiKey: string, extra?: Record<string, string>): Record<string, string> {
  const referer = openRouterReferer();
  return {
    authorization: `Bearer ${apiKey}`,
    ...(referer ? { "HTTP-Referer": referer } : {}),
    "X-OpenRouter-Title": "Atlas",
    "X-Title": "Atlas",
    ...extra,
  };
}

function redact(body: unknown, apiKey: string): unknown {
  if (!apiKey || body === null || typeof body !== "object") return body;
  const json = JSON.stringify(body).replaceAll(apiKey, "[redacted]");
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return body;
  }
}

function providerError(status: number, what: string, body: unknown, apiKey: string): Error {
  const safe = redact(body, apiKey);
  const detail =
    safe && typeof safe === "object" ? (safe as { error?: unknown; message?: unknown }) : {};
  const nested =
    detail.error && typeof detail.error === "object"
      ? (detail.error as { message?: unknown }).message
      : undefined;
  const raw = [
    detail.message,
    typeof detail.error === "string" ? detail.error : undefined,
    nested,
  ].find((value): value is string => typeof value === "string" && value.trim() !== "");
  const short = raw
    ?.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
    .trim()
    .slice(0, MAX_SERVER_DETAIL_LENGTH);
  return voiceRequestError(status, PROVIDER_NAME, what, short ? { message: short } : safe, safe);
}

function mediaType(res: Response): string {
  return (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

function voicesForModel(body: unknown, modelId: string): VoiceInfo[] {
  const data =
    body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : [];
  const match = data.find(
    (item): item is { supported_voices?: unknown } =>
      Boolean(item) && typeof item === "object" && (item as { id?: unknown }).id === modelId,
  );
  const voices = Array.isArray(match?.supported_voices) ? match.supported_voices : [];
  const listed = voices
    .filter(
      (id): id is string =>
        typeof id === "string" && id.trim().length > 0 && id.length <= MAX_VOICE_ID_LENGTH,
    )
    .slice(0, MAX_LISTED_VOICES)
    .map((id) => ({ id, label: id }));
  if (listed.length) return listed;
  if (isFishOpenRouterTtsModel(modelId)) {
    return [{ id: DEFAULT_OPENROUTER_FISH_VOICE_ID, label: "Selene" }];
  }
  return [{ id: OPENROUTER_DEFAULT_VOICE_ID, label: "Default" }];
}

export class OpenRouterVoiceProvider implements VoiceProvider {
  describe(): AdapterDescriptor<VoiceCapabilities> {
    return {
      id: OPENROUTER_VOICE_PROVIDER_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { catalog: true, synthesize: true, transcribe: true },
    };
  }

  async verify(apiKey: string, context: AdapterContext): Promise<VoiceVerifyResult> {
    let secret: OpenRouterVoiceSecret;
    try {
      secret = parseOpenRouterVoiceSecret(apiKey);
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "That OpenRouter connection is not valid.",
      };
    }
    try {
      const res = await fetch(`${API}/key`, {
        headers: headers(secret.apiKey),
        redirect: "error",
        signal: voiceDeadline(context.signal, 20_000),
      });
      if (res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: true };
      }
      return {
        ok: false,
        message: voiceHttpError(
          res.status,
          PROVIDER_NAME,
          "checking that key",
          redact(await readVoiceJson(res), secret.apiKey),
        ),
      };
    } catch {
      return { ok: false, message: voiceUnreachable(PROVIDER_NAME) };
    }
  }

  async listVoices(apiKey: string, context: AdapterContext): Promise<VoiceInfo[]> {
    const secret = parseOpenRouterVoiceSecret(apiKey);
    try {
      const signal = voiceDeadline(context.signal, 15_000);
      const res = await fetch(`${API}/models?output_modalities=speech`, {
        headers: headers(secret.apiKey),
        redirect: "error",
        signal,
      });
      const body = await readVoiceJson(res);
      if (!res.ok) throw providerError(res.status, "listing voices", body, secret.apiKey);
      return voicesForModel(body, secret.ttsModel);
    } catch (error) {
      if (context.signal.aborted) throw error;
      return voicesForModel({ data: [] }, secret.ttsModel);
    }
  }

  async synthesize(request: VoiceSynthesizeRequest, context: AdapterContext): Promise<SpeechClip> {
    const secret = parseOpenRouterVoiceSecret(request.apiKey);
    const signal = voiceDeadline(request.signal ?? context.signal, 60_000);
    const voice = openRouterSpeechVoice(request.voiceId, secret.ttsModel);
    const res = await fetch(`${API}/audio/speech`, {
      method: "POST",
      headers: headers(secret.apiKey, { "content-type": "application/json" }),
      redirect: "error",
      body: JSON.stringify({
        model: secret.ttsModel,
        input: request.text,
        response_format: "mp3",
        // Sending the literal "default" is rejected; omit voice only when the provider allows it.
        ...(voice ? { voice } : {}),
      }),
      signal,
    });
    if (!res.ok) {
      throw providerError(res.status, "speaking", await readVoiceJson(res), secret.apiKey);
    }
    const type = mediaType(res);
    const mimeType =
      type === "audio/mpeg" || type === "audio/mp3"
        ? "audio/mpeg"
        : type === "audio/wav" || type === "audio/wave" || type === "audio/x-wav"
          ? "audio/wav"
          : undefined;
    if (!mimeType) {
      await res.body?.cancel().catch(() => undefined);
      throw new Error(`${PROVIDER_NAME} did not return MP3 audio.`);
    }
    return { bytes: await readVoiceAudio(res, signal), mimeType };
  }

  async transcribe(
    request: VoiceTranscribeRequest,
    context: AdapterContext,
  ): Promise<{ text: string }> {
    const secret = parseOpenRouterVoiceSecret(request.apiKey);
    const form = new FormData();
    form.set("model", secret.sttModel);
    form.set("response_format", "json");
    const language = request.language?.split("-")[0]?.toLowerCase();
    if (language && /^[a-z]{2,3}$/.test(language)) form.set("language", language);
    form.set(
      "file",
      new Blob([new Uint8Array(request.audio)], { type: request.mimeType || "audio/webm" }),
      speechUploadName(request.mimeType),
    );
    const res = await fetch(`${API}/audio/transcriptions`, {
      method: "POST",
      headers: headers(secret.apiKey),
      redirect: "error",
      body: form,
      signal: voiceDeadline(request.signal ?? context.signal, 60_000),
    });
    const raw = await readVoiceText(res);
    const type = mediaType(res);
    if (!res.ok) {
      throw providerError(res.status, "transcribing", parseJson(raw), secret.apiKey);
    }
    if (type && type !== "text/plain" && type !== "application/json") {
      throw new Error(`${PROVIDER_NAME} did not return a transcript.`);
    }
    const parsed = parseJson(raw);
    if (parsed && typeof parsed === "object") {
      return { text: String((parsed as { text?: unknown }).text ?? "").trim() };
    }
    if (type === "application/json" || raw === null) {
      throw new Error(`${PROVIDER_NAME} did not return a transcript.`);
    }
    return { text: raw.trim() };
  }
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
