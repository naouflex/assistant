/** UI preset only; saved connections use the OpenAI-compatible provider. */
export const OLLAMA_CLOUD_BASE_URL = "https://ollama.com/v1";

export function isOllamaCloudBaseUrl(baseUrl: string | undefined): boolean {
  try {
    return normalizeOpenAiCompatibleBaseUrl(baseUrl ?? "") === OLLAMA_CLOUD_BASE_URL;
  } catch {
    return false;
  }
}

export function compatibleConnectionName(baseUrl: string | undefined, fallback: string): string {
  return isOllamaCloudBaseUrl(baseUrl) ? "Ollama Cloud" : fallback;
}

export const OPENAI_COMPATIBLE_BASE_URL_HINT =
  "Paste the OpenAI-compatible address from your server. Atlas adds /v1 if needed.";

/** Connect when base URL and model id are set. */
export function openAiCompatibleConnectReady(input: {
  baseUrl: string;
  modelId: string;
  apiKey?: string;
}): boolean {
  return Boolean(
    input.baseUrl.trim() &&
      input.modelId.trim() &&
      (!isOllamaCloudBaseUrl(input.baseUrl) || input.apiKey?.trim()),
  );
}

export function openAiCompatibleProbeSuccessMessage(modelCount: number): string {
  return modelCount
    ? `Found ${modelCount} model${modelCount === 1 ? "" : "s"}.`
    : "Server found. Enter a model name.";
}

/** The canonical endpoint the server stores: trailing slashes dropped, `/v1` added only when no
 * path segment is already a version (`v1`, `v4`, `v1beta`, ...), so gateways that route models by
 * path (`/v1/some-model`) keep their URL verbatim. */
export function normalizeOpenAiCompatibleBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Base URL must be an absolute HTTP(S) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Base URL must not contain credentials");
  }
  let path = url.pathname.replace(/\/+$/, "") || "";
  const VERSION_SEGMENT = /^v\d+[a-z]*$/;
  if (!path.split("/").some((segment) => VERSION_SEGMENT.test(segment))) {
    path = path ? `${path}/v1` : "/v1";
  }
  return `${url.origin}${path}`;
}

/** Self-hosted transcription default for mlx-audio-style servers; speech model is set in Voice settings. */
export const DEFAULT_COMPATIBLE_TTS_MODEL = "";
export const SELF_HOSTED_TTS_MODEL_PLACEHOLDER = "your-tts-model";
export const DEFAULT_COMPATIBLE_STT_MODEL = "mlx-community/whisper-large-v3-turbo-asr-fp16";

/** OpenRouter voice. Speech and transcription are separate model ids on one key. */
export const OPENROUTER_VOICE_PROVIDER_ID = "openrouter";
/** Fish Audio S2.1 Pro's free OpenRouter endpoint. It lists no voices of its own. */
export const DEFAULT_OPENROUTER_TTS_MODEL = "fish-audio/s2.1-pro-free:free";
export const DEFAULT_OPENROUTER_STT_MODEL = "openai/whisper-large-v3-turbo";
/** Stable Fish voice on OpenRouter when the catalog returns `supported_voices: null`. */
export const DEFAULT_OPENROUTER_FISH_VOICE_ID = "b347db033a6549378b48d00acb0d06cd";
export const OPENROUTER_DEFAULT_VOICE_ID = "default";

export function isOpenRouterFishTtsModel(modelId: string): boolean {
  return modelId.trim().startsWith("fish-audio/");
}

/** OpenRouter returns this when a model has no voice catalog; it is not a stable Fish voice. */
export function isOpenRouterPlaceholderVoiceId(voiceId: string): boolean {
  const normalized = voiceId.trim().toLowerCase();
  return !normalized || normalized === OPENROUTER_DEFAULT_VOICE_ID;
}

/**
 * Fish Audio preset voices for OpenRouter fish-audio/* speech models. OpenRouter does not
 * list them; these ids come from Fish's public voice library and work as the `voice` field.
 */
const OPENROUTER_FISH_VOICE_CATALOG: readonly { id: string; label: string }[] = [
  { id: DEFAULT_OPENROUTER_FISH_VOICE_ID, label: "Selene" },
  { id: "9a9cf47702da476aa4629e2506d4a857", label: "Hannah" },
  { id: "bf322df2096a46f18c579d0baa36f41d", label: "Adrian" },
  { id: "536d3a5e000945adb7038665781a4aca", label: "Ethan" },
  { id: "8abfa9ebd4c24a3399b68c3cdac8c7b5", label: "Freya" },
  { id: "8d8aec63a56c460cb7def795bdf754fa", label: "Oliver" },
  { id: "ac23b666ac6149839d350ab4af7e4979", label: "Charlotte" },
  { id: "ce9db9be1ecb4c8a832802626864595d", label: "Liam" },
  { id: "16cabdb7f8d240569aff36c9e480d783", label: "Amelia" },
  { id: "0db6e93af420470b9d9b9a886dbaa954", label: "Kai" },
  { id: "e3cd384158934cc9a01029cd7d278634", label: "Laura" },
  { id: "18b7e3bed34d46b088b8fbd10926feb2", label: "Michael" },
  { id: "a5aafcd92cee4a7db52ee34c82fedcab", label: "Nova" },
  { id: "db6abd0e4d5544e4ac75d777d90b9a35", label: "Theo" },
  { id: "fbc1029c018041d4b17f2c1e57222dff", label: "Richard" },
  { id: "c250136a9ec74cc0b799be54664a83f2", label: "Harper" },
  { id: "6d7a45828f6a432c9233cd93bb93e5be", label: "Chidi" },
  { id: "18b1276891524bd786fb8a59ecd3630a", label: "Ananya" },
  { id: "8634617958764b539e0cdd5eb6c7723e", label: "Abel" },
  { id: "1258154bb41540c7b9dc0d10cd6704bf", label: "Amara" },
  { id: "1dc966a13a564043ae15591f997a3144", label: "Sarah" },
];

export function openRouterFishCatalogVoices(): { id: string; label: string }[] {
  return [...OPENROUTER_FISH_VOICE_CATALOG];
}

/** Merge a provider voice list with Fish and placeholder fallbacks for the speech model. */
export function openRouterVoicesForPicker(
  ttsModel: string,
  listed: readonly { id: string; label: string; description?: string }[],
): { id: string; label: string; description?: string }[] {
  const model = ttsModel.trim() || DEFAULT_OPENROUTER_TTS_MODEL;
  const usable = listed.filter((voice) => !isOpenRouterPlaceholderVoiceId(voice.id));
  if (isOpenRouterFishTtsModel(model)) {
    const catalog = openRouterFishCatalogVoices();
    if (!usable.length) return catalog;
    const merged = new Map(catalog.map((voice) => [voice.id, voice]));
    for (const voice of usable) merged.set(voice.id, voice);
    return [...merged.values()];
  }
  if (usable.length) return [...usable];
  return [{ id: OPENROUTER_DEFAULT_VOICE_ID, label: "Default" }];
}

/** Picker fallback when the voices API fails or has not loaded yet. */
export function openRouterFallbackVoices(ttsModel: string): { id: string; label: string }[] {
  return openRouterVoicesForPicker(ttsModel, []);
}

/** Preferred default, explicit enabled id (preferred first), then a list-less legacy fallback.
 * Candidates must be in stable credential order, newest first.
 */
export function selectCompatibleModelCredential<
  C extends {
    defaultModel?: string | null;
    enabledModelIds?: readonly string[] | null;
  },
>(preferred: C, candidates: readonly C[], modelId: string): C | undefined {
  if (preferred.defaultModel === modelId || preferred.enabledModelIds?.includes(modelId))
    return preferred;
  return (
    candidates.find((candidate) => candidate.enabledModelIds?.includes(modelId)) ??
    (preferred.enabledModelIds === undefined ? preferred : undefined)
  );
}

/** Match a typed endpoint to the canonical saved endpoint; incomplete input never matches. */
export function savedCompatibleEndpointMatches(
  baseUrl: string,
  savedBaseUrl: string | undefined,
): boolean {
  try {
    return Boolean(savedBaseUrl) && normalizeOpenAiCompatibleBaseUrl(baseUrl) === savedBaseUrl;
  } catch {
    return false;
  }
}
