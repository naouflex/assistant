/**
 * Finds the models local servers actually serve, so the model picker lists them
 * without the operator copying ids into ATLAS_LOCAL_MODELS. Both llama-server and
 * Ollama answer the OpenAI-compatible `GET {base}/models`; Ollama's native
 * `/api/tags` is the fallback. Discovery is best effort: a server that is down
 * or slow just contributes nothing, and configured ids always stay listed.
 */

/** Comma-separated extra OpenAI-compatible base URLs to scan, or "off". */
export const LOCAL_DISCOVERY_URLS_ENV = "ATLAS_LOCAL_DISCOVERY_URLS";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/v1";
const DISCOVERY_TIMEOUT_MS = 2_000;
const DISCOVERY_INTERVAL_MS = 60_000;
const MAX_DISCOVERED_MODELS = 64;

export type DiscoveredLocalModel = {
  id: string;
  /** Other names the server answers to (llama-server `--alias`). */
  aliases: string[];
  baseUrl: string;
  /** True when the server reports image input for the model. */
  images: boolean;
};

type Env = Record<string, string | undefined>;
type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

function trimBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Servers to scan: the configured local server first, then the extra list, which
 * defaults to the stock Ollama port. Nothing is scanned unless the local provider
 * is configured, so installs without local models behave as before.
 */
export function localDiscoveryUrls(env: Env = process.env): string[] {
  const configured = env.ATLAS_LOCAL_MODELS_URL?.trim();
  const ids = env.ATLAS_LOCAL_MODELS?.trim();
  const extraRaw = env[LOCAL_DISCOVERY_URLS_ENV]?.trim();
  if (extraRaw?.toLowerCase() === "off") return [];
  if (!configured && !ids && !extraRaw) return [];
  const extra =
    extraRaw === undefined || extraRaw === "" ? [DEFAULT_OLLAMA_URL] : extraRaw.split(",");
  const urls: string[] = [];
  for (const candidate of [configured || DEFAULT_OLLAMA_URL, ...extra]) {
    const url = trimBase(candidate);
    if (url && validHttpUrl(url) && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

/** Model entries from an OpenAI-style `{data:[...]}` or Ollama `{models:[...]}` body. */
export function parseServerModels(body: unknown, baseUrl: string): DiscoveredLocalModel[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const out: DiscoveredLocalModel[] = [];
  const push = (id: unknown, aliases: string[], images: boolean) => {
    if (typeof id !== "string" || !id.trim()) return;
    const name = id.trim();
    if (out.some((model) => model.id === name)) return;
    out.push({ id: name, aliases: aliases.filter((alias) => alias !== name), baseUrl, images });
  };
  if (Array.isArray(record.data)) {
    for (const item of record.data) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const architecture = entry.architecture as Record<string, unknown> | undefined;
      const images = strings(architecture?.input_modalities).includes("image");
      push(entry.id, strings(entry.aliases), images);
    }
  } else if (Array.isArray(record.models)) {
    for (const item of record.models) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      push(entry.name ?? entry.model, [], strings(entry.capabilities).includes("vision"));
    }
  }
  return out.slice(0, MAX_DISCOVERED_MODELS);
}

async function getJson(fetchImpl: Fetch, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function scanServer(fetchImpl: Fetch, baseUrl: string): Promise<DiscoveredLocalModel[]> {
  const listed = parseServerModels(await getJson(fetchImpl, `${baseUrl}/models`), baseUrl);
  if (listed.length) return listed;
  const origin = baseUrl.replace(/\/v1$/, "");
  return parseServerModels(await getJson(fetchImpl, `${origin}/api/tags`), baseUrl);
}

/** Scans every server; the first server to report an id (or alias) owns it. */
export async function discoverLocalModels(
  env: Env = process.env,
  fetchImpl: Fetch = fetch,
): Promise<DiscoveredLocalModel[]> {
  const urls = localDiscoveryUrls(env);
  const results = await Promise.all(urls.map((url) => scanServer(fetchImpl, url)));
  const seen = new Set<string>();
  const out: DiscoveredLocalModel[] = [];
  for (const model of results.flat()) {
    const names = [model.id, ...model.aliases];
    if (names.some((name) => seen.has(name))) continue;
    for (const name of names) seen.add(name);
    out.push(model);
  }
  return out.slice(0, MAX_DISCOVERED_MODELS);
}

let discovered: DiscoveredLocalModel[] = [];
let version = 0;

/** Models found by the last scan. */
export function discoveredLocalModels(): readonly DiscoveredLocalModel[] {
  return discovered;
}

/** Bumps whenever the discovered list changes, so cached catalogs rebuild. */
export function localModelsVersion(): number {
  return version;
}

function signature(models: readonly DiscoveredLocalModel[]): string {
  return JSON.stringify(
    models.map((model) => [model.id, model.aliases, model.baseUrl, model.images]),
  );
}

/** Replaces the discovered list; returns whether it changed. */
export function setDiscoveredLocalModels(models: DiscoveredLocalModel[]): boolean {
  if (signature(models) === signature(discovered)) return false;
  discovered = models;
  version += 1;
  return true;
}

/** Scans now and then every minute. Returns a stop function. */
export function startLocalModelDiscovery(
  env: Env = process.env,
  fetchImpl: Fetch = fetch,
  intervalMs = DISCOVERY_INTERVAL_MS,
): () => void {
  if (!localDiscoveryUrls(env).length) return () => {};
  let stopped = false;
  const refresh = async () => {
    const models = await discoverLocalModels(env, fetchImpl).catch(() => undefined);
    if (!stopped && models) setDiscoveredLocalModels(models);
  };
  void refresh();
  const timer = setInterval(() => void refresh(), intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
