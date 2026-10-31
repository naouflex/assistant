import type { ThinkingLevel } from "@atlas/contracts";

/** Whether a run thinks, given the saved level and the model's own default. */
export function thinkingIsOn(
  saved: ThinkingLevel | null | undefined,
  defaultLevel: ThinkingLevel | undefined,
): boolean {
  return (saved ?? defaultLevel ?? "medium") !== "off";
}

/** The levels a thinking toggle can switch between, or null when the model has no choice. */
export function thinkingToggleLevels(levels: readonly ThinkingLevel[] | undefined) {
  if (!levels?.includes("off")) return null;
  const on = levels.find((level) => level === "medium") ?? levels.find((level) => level !== "off");
  return on ? { off: "off" as const, on } : null;
}

/** A model's choosable levels, Off included, or none when it cannot think at all. */
export function selectableThinkingLevels(levels: readonly ThinkingLevel[]): ThinkingLevel[] {
  return levels.some((level) => level !== "off") ? [...levels] : [];
}
