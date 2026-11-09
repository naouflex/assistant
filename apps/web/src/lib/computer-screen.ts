import { isLocalhostOrLoopbackIp } from "@atlas/contracts";
import { WUYING_SCREEN_PATH } from "@atlas/contracts/content-security-policy";
import { t } from "@lingui/core/macro";
import { errorText } from "./user-error";

export interface ComputerScreenResult {
  url: string | null;
  error: string | null;
}

/** Only the latest request for the visible computer may replace its screen or error. */
export async function loadComputerScreen(options: {
  load: () => Promise<{ url: string | null }>;
  isCurrent: () => boolean;
  commit: (result: ComputerScreenResult) => void;
  fallbackError: string;
}): Promise<string | null> {
  let result: ComputerScreenResult;
  try {
    const screen = await options.load();
    result = { url: screen.url, error: null };
  } catch (error) {
    result = {
      url: null,
      error: errorText(error, options.fallbackError),
    };
  }
  if (!options.isCurrent()) return null;
  options.commit(result);
  return result.url;
}

export function embeddableScreenUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.href);
    const page = new URL(window.location.href);
    // A Wuying desktop is drawn by its Web SDK in a page this server serves. Its one-time login
    // code rides in the fragment so it never reaches a server log.
    if (parsed.protocol === "wuying:") {
      return `${page.origin}${WUYING_SCREEN_PATH}#${parsed.searchParams.toString()}`;
    }
    // The server that served this page proxies /novnc/. Keep the frame on this origin even when the
    // API's WEB_ORIGIN names another host for it (localhost vs 127.0.0.1), as the CSP frames 'self'.
    if (parsed.pathname.startsWith("/novnc/")) {
      return `${page.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    const local = isLocalhostOrLoopbackIp(parsed.hostname);
    const pagePort = page.port || (page.protocol === "https:" ? "443" : "80");
    if (local && parsed.port && parsed.port !== pagePort) {
      return null;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * A Wuying screen URL carries a one-time login code, so every read of it differs. Reloading the
 * frame for a new code would open a second session that signs the first one out; the screen keeps
 * the URL it connected with until the desktop or the view changes.
 */
export function sameWuyingScreen(current: string | null, next: string | null): boolean {
  if (!current || !next) return false;
  try {
    const a = new URL(current);
    const b = new URL(next);
    if (a.protocol !== "wuying:" || b.protocol !== "wuying:") return false;
    return ["desktop_id", "region_id", "view_only"].every(
      (name) => a.searchParams.get(name) === b.searchParams.get(name),
    );
  } catch {
    return false;
  }
}

export function screenIframeSandbox(url: string | null) {
  if (!url) return undefined;
  try {
    const pathname = new URL(url, window.location.href).pathname;
    return pathname.startsWith("/novnc/") || pathname === WUYING_SCREEN_PATH
      ? "allow-scripts allow-pointer-lock"
      : undefined;
  } catch {
    return undefined;
  }
}

/** Deduplicate only the boot request; callers can still take over and refresh. */
export async function bootComputerOnce<T>(
  inFlight: Map<string, symbol>,
  botId: string,
  boot: () => Promise<T>,
): Promise<T | undefined> {
  if (inFlight.has(botId)) return;
  const token = Symbol(botId);
  inFlight.set(botId, token);
  try {
    return await boot();
  } finally {
    if (inFlight.get(botId) === token) inFlight.delete(botId);
  }
}

export const JOIN_BOOT_POLL_MS = 2_000;
export const JOIN_BOOT_TIMEOUT_MS = 90_000;

/**
 * A boot refused as busy means someone else (a run, another tab) is starting this computer.
 * Wait for that boot instead of reporting an error the panel would never clear.
 */
export async function bootOrJoinBoot<T extends { state: string }>(options: {
  boot: () => Promise<T>;
  status: () => Promise<T>;
  isBusy: (error: unknown) => boolean;
  keepWaiting: () => boolean;
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T | undefined> {
  try {
    return await options.boot();
  } catch (error) {
    if (!options.isBusy(error)) throw error;
    const sleep =
      options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const pollMs = options.pollMs ?? JOIN_BOOT_POLL_MS;
    for (let waited = 0; waited < (options.timeoutMs ?? JOIN_BOOT_TIMEOUT_MS); waited += pollMs) {
      await sleep(pollMs);
      if (!options.keepWaiting()) return undefined;
      const current = await options.status();
      if (current.state === "running") return current;
    }
    throw error;
  }
}

/** Only pages the web proxy serves carry the shim that reports their state to the app. */
export function isProxiedScreenUrl(url: string | null): url is string {
  return screenIframeSandbox(url) !== undefined;
}

/** How long a framed screen may stay silent before the app treats it as not loaded. */
export const SCREEN_FRAME_LOAD_TIMEOUT_MS = 15_000;

/** Matches the sealed screen capability lifetime in the API proxy. */
const SCREEN_CAPABILITY_TTL_MS = 60 * 60_000;
/**
 * Re-read the screen URL this long after it was issued so the iframe gets a fresh
 * capability before the token in its current URL expires.
 */
export const SCREEN_URL_RENEW_MS = 50 * 60_000;
const SCREEN_SOURCE_RENEW_REMAINING_MS =
  SCREEN_CAPABILITY_TTL_MS - SCREEN_URL_RENEW_MS + 5 * 60_000;

function screenCapabilityExpiresAt(url: string): number | null {
  try {
    const match = new URL(url, "http://localhost").pathname.match(
      /^\/novnc\/session\/(?:view|control)\/(\d+)\./,
    );
    if (!match) return null;
    const expiresAt = Number(match[1]);
    return Number.isSafeInteger(expiresAt) ? expiresAt : null;
  } catch {
    return null;
  }
}

/** When to start the renew timer: issue time for sealed URLs, else the read time. */
export function screenRenewReadAt(url: string | null, readAt: number): number {
  const expiresAt = url ? screenCapabilityExpiresAt(url) : null;
  if (expiresAt == null) return readAt;
  return expiresAt - SCREEN_CAPABILITY_TTL_MS;
}

/**
 * Identity of a live screen stream, ignoring rotating capability tokens.
 * View vs control stays in the key so takeover/release still reload.
 */
export function screenStreamKey(url: string): string {
  try {
    const parsed = new URL(url, "http://localhost");
    const match = parsed.pathname.match(/^\/novnc\/session\/(view|control)\/[^/]+(\/.*)?$/);
    if (match) return `${parsed.origin}/novnc/session/${match[1]}${match[2] ?? ""}`;
    const viewOnly = parsed.searchParams.get("view_only");
    const policy = viewOnly == null ? "" : `?view_only=${viewOnly}`;
    return `${parsed.origin}${parsed.pathname}${policy}`;
  } catch {
    return url;
  }
}

/**
 * Keep the connected screen URL while only the capability token rotated.
 * Adopt a newer same-stream URL once the held capability is in the renew window.
 */
export function retainScreenSource(held: string, next: string, now = Date.now()): string {
  if (screenStreamKey(held) !== screenStreamKey(next)) return next;
  const heldExpires = screenCapabilityExpiresAt(held);
  const nextExpires = screenCapabilityExpiresAt(next);
  if (
    heldExpires != null &&
    nextExpires != null &&
    nextExpires > heldExpires &&
    heldExpires - now <= SCREEN_SOURCE_RENEW_REMAINING_MS
  ) {
    return next;
  }
  return held;
}

/** Pick the URL an iframe should keep when the API returns a rotated capability. */
export function retainProxiedScreenUrl(held: string | null, next: string | null): string | null {
  if (!next) return next;
  if (!held || !isProxiedScreenUrl(held) || !isProxiedScreenUrl(next)) return next;
  return retainScreenSource(held, next);
}

export type ScreenFrameState = "loading" | "connecting" | "connected" | "failed" | "disconnected";

export interface ScreenFrameMessage {
  atlasScreen: ScreenFrameState;
  detail?: string;
}

const SCREEN_FRAME_STATES: ReadonlySet<string> = new Set<ScreenFrameState>([
  "loading",
  "connecting",
  "connected",
  "failed",
  "disconnected",
]);

/** A state report posted by a framed screen page, or null for any other message. */
export function screenFrameMessage(data: unknown): ScreenFrameMessage | null {
  if (!data || typeof data !== "object") return null;
  const { atlasScreen, detail } = data as Record<string, unknown>;
  if (typeof atlasScreen !== "string" || !SCREEN_FRAME_STATES.has(atlasScreen)) return null;
  const text = typeof detail === "string" ? detail.trim().slice(0, 200) : "";
  return { atlasScreen: atlasScreen as ScreenFrameState, ...(text ? { detail: text } : {}) };
}

/** Whether a report shows the page got past loading; a page stalled there is still silent. */
export function screenFrameStarted(message: ScreenFrameMessage): boolean {
  return message.atlasScreen !== "loading";
}

/** The error a frame report means for the screen, or null while it is fine. */
export function screenFrameError(message: ScreenFrameMessage, fallback: string): string | null {
  if (message.atlasScreen !== "failed" && message.atlasScreen !== "disconnected") return null;
  return message.atlasScreen === "disconnected" ? t`The screen connection closed.` : fallback;
}

/**
 * Cookies a screen probe may attach. The capability in the URL authorizes the screen, so a host
 * that is not this page never receives the session cookie. A same-origin http(s) probe includes
 * it: an identity-aware proxy in front of this app answers a cookie-less request with a redirect,
 * and `redirect: "manual"` hides that as an opaque redirect the probe would treat as a failed
 * screen. Other schemes, such as a Wuying login URL, stay cookie-less.
 */
function screenProbeCredentials(url: string): RequestCredentials {
  const pageHref = pageLocationHref();
  if (!pageHref) return "omit";
  try {
    const target = new URL(url, pageHref);
    if (target.protocol !== "http:" && target.protocol !== "https:") return "omit";
    return target.origin === new URL(pageHref).origin ? "same-origin" : "omit";
  } catch {
    return "omit";
  }
}

function pageLocationHref(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const href = window.location?.href;
  return typeof href === "string" ? href : undefined;
}

/**
 * Ask the proxy for the page before framing it. A frame cannot say why it failed to load, so a
 * refused or unreachable screen would otherwise stay blank.
 */
export async function probeScreen(
  url: string,
  fallback: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(url, {
      credentials: screenProbeCredentials(url),
      cache: "no-store",
      redirect: "manual",
    });
    if (response.ok) return null;
    // The proxy couldn't reach the API to check the screen: that's a connection problem.
    if (response.type === "opaqueredirect" || response.status === 503) return fallback;
    if (response.status === 403) return t`The screen link expired.`;
    const body = await response.text().catch(() => "");
    if (response.status === 502 && body.trim() === "Screen unavailable (upstream_timeout)") {
      return t`The screen did not respond.`;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * The screen page's status through the proxy's access check, or null if it couldn't be asked.
 * Only the status is read; the body is dropped unread.
 */
export async function probeScreenStatus(
  url: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const response = await fetchImpl(url, {
      credentials: screenProbeCredentials(url),
      cache: "no-store",
      redirect: "manual",
      signal,
    });
    void response.body?.cancel().catch(() => undefined);
    return response.type === "opaqueredirect" ? 0 : response.status;
  } catch {
    return null;
  }
}

/**
 * Whether a reconnected screen takes the keyboard back: only a screen that had it when it
 * dropped, and only if the user hasn't moved on. Focus anywhere else in the app, or the screen
 * failing, forgets it, and it happens at most once per drop.
 */
export function createScreenRefocus() {
  let pending = false;
  return {
    dropped(hadFocus: boolean) {
      pending = hadFocus;
    },
    forget() {
      pending = false;
    },
    /** On a reconnected screen's "connected": whether to give it the keyboard now. */
    connected(active: Element | null, frame: Element, body: Element | null): boolean {
      if (!pending) return false;
      pending = false;
      return !active || active === body || active === frame;
    },
  };
}
