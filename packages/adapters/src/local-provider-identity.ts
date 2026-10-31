/**
 * The local provider's id and cache window, kept apart from pi-local-provider so modules that only
 * need these stay independent of the provider registration (which tests replace with a mock).
 */
export const LOCAL_PROVIDER_ID = "local";

/**
 * Ollama and llama.cpp keep the last prompt's KV cache per slot while the model stays loaded
 * (OLLAMA_KEEP_ALIVE). Declaring that window makes context selection keep the prefix stable
 * across turns instead of sliding a recent-message window that is re-read every turn.
 */
export function localCacheCapabilities(): {
  scope: "connection";
  retentionMode: "short";
  retentionMs: number;
} {
  return {
    scope: "connection",
    retentionMode: "short",
    retentionMs: positiveEnv("ATLAS_LOCAL_CACHE_RETENTION_MS", 30 * 60_000),
  };
}

function positiveEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, received "${raw}"`);
  }
  return value;
}
