import { Platform } from "react-native";

type HapticsModule = typeof import("expo-haptics");

// Loaded lazily and optionally: a JS update can run on a build that predates the native module,
// and tests and the web have none. Haptics are a nicety; a failure is never surfaced.
let haptics: HapticsModule | null | undefined;

function load(): HapticsModule | null {
  if (haptics !== undefined) return haptics;
  haptics = null;
  try {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return haptics;
    // Required here, not imported: importing expo-modules-core at the top would load it in
    // every screen's tests.
    const core = require("expo-modules-core") as typeof import("expo-modules-core");
    if (!core.requireOptionalNativeModule("ExpoHaptics")) return haptics;
    haptics = require("expo-haptics") as HapticsModule;
  } catch {
    haptics = null;
  }
  return haptics;
}

/** A light tap, for a button that starts or stops something (send, play, a call). */
export function tapHaptic(): void {
  const module = load();
  void module?.impactAsync(module.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/** A tick, for picking or toggling something (a menu opening, a switch). */
export function selectionHaptic(): void {
  void load()
    ?.selectionAsync()
    .catch(() => undefined);
}

/** Something worked that the user waited on, or failed in a way they must notice. */
export function notifyHaptic(kind: "success" | "warning" | "error"): void {
  const module = load();
  if (!module) return;
  const type = {
    success: module.NotificationFeedbackType.Success,
    warning: module.NotificationFeedbackType.Warning,
    error: module.NotificationFeedbackType.Error,
  }[kind];
  void module.notificationAsync(type).catch(() => undefined);
}

/** Test seam: forget the loaded module. */
export function resetHapticsForTests(): void {
  haptics = undefined;
}
