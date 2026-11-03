import { z } from "zod";

export const PHONE_SCREENSHOT_TOOL = "phone_screenshot";
export const PHONE_UI_TREE_TOOL = "phone_ui_tree";
export const PHONE_TAP_TOOL = "phone_tap";
export const PHONE_SWIPE_TOOL = "phone_swipe";
export const PHONE_TYPE_TOOL = "phone_type";
export const PHONE_KEY_TOOL = "phone_key";
export const PHONE_OPEN_APP_TOOL = "phone_open_app";
export const PHONE_SHELL_TOOL = "phone_shell";
export const PHONE_NOTIFICATION_TOOL = "phone_notifications";

/** Look at or drive the phone's screen; one approval covers them all for the space. */
export const PHONE_CONTROL_TOOLS: ReadonlySet<string> = new Set([
  PHONE_SCREENSHOT_TOOL,
  PHONE_UI_TREE_TOOL,
  PHONE_TAP_TOOL,
  PHONE_SWIPE_TOOL,
  PHONE_TYPE_TOOL,
  PHONE_KEY_TOOL,
  PHONE_OPEN_APP_TOOL,
]);
export const PHONE_TOOLS: ReadonlySet<string> = new Set([
  ...PHONE_CONTROL_TOOLS,
  PHONE_SHELL_TOOL,
  PHONE_NOTIFICATION_TOOL,
]);

/** Paired devices with this platform are phones; every other platform is a computer. */
export const PHONE_PLATFORM = "android";
export type UserDeviceKind = "computer" | "phone";

export function userDeviceKind(platform: string): UserDeviceKind {
  return platform === PHONE_PLATFORM ? "phone" : "computer";
}

export const PHONE_KEYS = [
  "back",
  "home",
  "recents",
  "notifications",
  "quick_settings",
  "enter",
  "lock",
  "power_dialog",
] as const;
export const PHONE_SHELL_MAX_COMMAND = 64 * 1024;
export const PHONE_TYPE_MAX_TEXT = 10_000;
export const PHONE_NOTIFICATION_VERBS = ["list", "open", "dismiss", "activate"] as const;
export const PHONE_NOTIFICATION_KEY_MAX = 300;

const coordinate = z.number().int().min(0).max(20_000);
const element = z.number().int().min(0).max(100_000);

/** Coordinates are pixels of the latest phone_screenshot; the phone maps them to its screen. */
export const phoneAction = z.discriminatedUnion("op", [
  z.object({ op: z.literal("screenshot") }),
  z.object({ op: z.literal("uiTree"), query: z.string().max(200).optional() }),
  z.object({
    op: z.literal("tap"),
    element: element.optional(),
    x: coordinate.optional(),
    y: coordinate.optional(),
    long: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("swipe"),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    x1: coordinate.optional(),
    y1: coordinate.optional(),
    x2: coordinate.optional(),
    y2: coordinate.optional(),
    durationMs: z.number().int().min(50).max(5_000).optional(),
  }),
  z.object({
    op: z.literal("type"),
    text: z.string().max(PHONE_TYPE_MAX_TEXT),
    element: element.optional(),
    submit: z.boolean().optional(),
  }),
  z.object({ op: z.literal("key"), key: z.enum(PHONE_KEYS) }),
  z.object({ op: z.literal("openApp"), app: z.string().trim().min(1).max(200) }),
  z.object({
    op: z.literal("shell"),
    command: z.string().min(1).max(PHONE_SHELL_MAX_COMMAND),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(30 * 60_000),
    termux: z.boolean().optional(),
    /** Shizuku on the phone: settings, input, and notification commands the app user cannot run. */
    privileged: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("notifications"),
    verb: z.enum(PHONE_NOTIFICATION_VERBS),
    key: z.string().min(1).max(PHONE_NOTIFICATION_KEY_MAX).optional(),
    button: z.string().min(1).max(80).optional(),
    text: z.string().max(PHONE_TYPE_MAX_TEXT).optional(),
  }),
]);
export type PhoneAction = z.infer<typeof phoneAction>;

/** What the phone shows: numbered accessibility rows and, for a screenshot, the image. */
export interface PhoneScreen {
  /** Package of the app in front. */
  package?: string;
  /** Numbered rows `[N] Class "text" (x1,y1,x2,y2)` in screenshot pixels. */
  tree?: string;
  width: number;
  height: number;
  image?: { mimeType: "image/png" | "image/jpeg"; data: string; width: number; height: number };
}

export interface PhoneShellResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  truncated?: boolean;
  runner: "sh" | "termux" | "privileged";
}

export interface PhoneNotification {
  key: string;
  package: string;
  app: string;
  title: string;
  text: string;
  when: number;
  ongoing: boolean;
  actions: string[];
}

/** `notifications` is a list; `done` is set when one notification was opened, dismissed, or used. */
export interface PhoneNotificationResult {
  notifications?: PhoneNotification[];
  done?: "opened" | "dismissed" | "activated";
}
