import path from "node:path";

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
 * Platform icon under `apps/desktop/assets`. Windows needs `.ico` or the shell falls back to
 * Electron's default; macOS dev uses the squircle export, Linux uses PNG.
 */
export function developmentIconFile(platform: NodeJS.Platform) {
  if (platform === "darwin") return "icon-macos.png";
  if (platform === "win32") return "icon.ico";
  return "icon.png";
}

/** Resolves the taskbar/window icon from bundled assets (dev and packaged). */
export function resolveDevelopmentIconPath(input: {
  platform: NodeJS.Platform;
  appPath: string;
  resourcesPath: string;
  isPackaged: boolean;
  exists: (filePath: string) => boolean;
}): string | undefined {
  const file = developmentIconFile(input.platform);
  const candidates = input.isPackaged
    ? [
        path.join(input.resourcesPath, "assets", file),
        path.join(input.appPath, "assets", file),
      ]
    : [path.join(input.appPath, "assets", file)];
  return candidates.find((candidate) => input.exists(candidate));
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
