export const DEFAULT_WARM_WINDOW_TTL_MS = 15 * 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function warmWindowTtlMs(value: string | undefined) {
  if (value === undefined || value.trim() === "") return DEFAULT_WARM_WINDOW_TTL_MS;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_TIMER_DELAY_MS
    ? parsed
    : DEFAULT_WARM_WINDOW_TTL_MS;
}

/** Matches sidebar header height so Windows caption buttons sit in the content chrome. */
export const WINDOWS_TITLE_BAR_OVERLAY_HEIGHT = 40;

function windowChrome(platform: NodeJS.Platform) {
  const mac = platform === "darwin";
  const win = platform === "win32";
  // Keep in sync with webDarkTokens.background from @atlas/ui-tokens (asserted in tests).
  // Do not import that package here: desktop packs compiled JS only and ui-tokens is a
  // TypeScript source / devDependency.
  const backgroundColor = "#161616";
  return {
    backgroundColor,
    show: true,
    autoHideMenuBar: true,
    // macOS: hiddenInset traffic lights. Windows: hidden title bar + native caption overlay
    // (no separate title strip). Linux: frameless with in-app controls.
    frame: mac || win,
    titleBarStyle: mac ? ("hiddenInset" as const) : win ? ("hidden" as const) : undefined,
    trafficLightPosition: mac ? { x: 16, y: 16 } : undefined,
    ...(win
      ? {
          titleBarOverlay: {
            color: backgroundColor,
            // Muted ink on the dark startup chrome (web --muted-foreground on dark).
            symbolColor: "#A8A8A8",
            height: WINDOWS_TITLE_BAR_OVERLAY_HEIGHT,
          },
        }
      : {}),
  };
}

type WorkArea = { width: number; height: number };

/** Opens as a window inside the screen's work area rather than filling it. */
export function browserWindowOptions(platform: NodeJS.Platform, workArea: WorkArea) {
  return {
    width: Math.min(1280, Math.round(workArea.width * 0.8)),
    height: Math.min(840, Math.round(workArea.height * 0.85)),
    ...windowChrome(platform),
  };
}

/**
 * Unpackaged (dev) launches set the dock/taskbar icon by hand. macOS draws the file as-is,
 * so it needs the squircle-with-margins asset; packaged builds already use icon.icns.
 */
export function developmentIconFile(platform: NodeJS.Platform) {
  return platform === "darwin" ? "icon-macos.png" : "icon.png";
}

/** The first-run setup window is smaller and keeps the same platform chrome. */
export function setupWindowOptions(platform: NodeJS.Platform, workArea: WorkArea) {
  const width = Math.min(720, workArea.width);
  const height = Math.min(700, workArea.height);
  return {
    width,
    height,
    minWidth: Math.min(480, width),
    minHeight: Math.min(560, height),
    ...windowChrome(platform),
  };
}
