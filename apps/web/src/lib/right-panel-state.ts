export type Panel =
  | "computer"
  | "routines"
  | "settings"
  | "routine"
  | "artifact"
  | "chart"
  | "create-group"
  | "group-settings"
  | "import-agent"
  | null;
export type RightPanelState = { panel: Panel; routineId?: string; artifactId?: string };

/** Panels that are safe to remember across reloads. */
const durablePanels: readonly Panel[] = [
  "computer",
  "routines",
  "settings",
  "routine",
  "artifact",
  "group-settings",
  null,
];

export function rightPanelStorageKey(
  userId: string,
  spaceId: string,
  kind: "bot" | "group",
  targetId: string,
): string {
  return `atlas:right-panel-state:${userId}:${spaceId}:${kind}:${targetId}`;
}

export function readRightPanelState(key: string): RightPanelState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("panel" in value) ||
      !durablePanels.includes(value.panel as Panel)
    )
      return { panel: null };
    const panel = value.panel as Panel;
    return {
      panel,
      ...(panel === "routine" &&
      "routineId" in value &&
      typeof value.routineId === "string" &&
      value.routineId
        ? { routineId: value.routineId }
        : {}),
      ...(panel === "artifact" &&
      "artifactId" in value &&
      typeof value.artifactId === "string" &&
      value.artifactId
        ? { artifactId: value.artifactId }
        : {}),
    };
  } catch {
    return { panel: null };
  }
}

export function writeRightPanelState(
  key: string,
  panel: Panel,
  detail?: { routineId?: string; artifactId?: string },
) {
  // Keep the last durable preference while an ephemeral panel is open.
  if (panel === "create-group" || panel === "import-agent" || panel === "chart") return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        panel,
        ...(panel === "routine" && detail?.routineId ? { routineId: detail.routineId } : {}),
        ...(panel === "artifact" && detail?.artifactId ? { artifactId: detail.artifactId } : {}),
      }),
    );
  } catch {
    // Restricted storage must not prevent opening or closing the panel.
  }
}
