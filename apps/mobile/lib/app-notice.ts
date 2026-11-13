/**
 * One short, dismissible notice at a time, shown above the voice dock, for things the user should
 * hear about but that do not deserve a blocking alert (e.g. a reply that could not be read aloud).
 */
export type AppNotice = {
  id: number;
  message: string;
  /** "warning" tints the icon; "info" is neutral. */
  tone: "info" | "warning";
  action?: { label: string; onPress: () => void };
  /** Auto-dismiss after this long; 0 keeps it until dismissed. */
  durationMs: number;
};

export const DEFAULT_NOTICE_MS = 6000;

let current: AppNotice | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getAppNotice(): AppNotice | null {
  return current;
}

export function subscribeAppNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shows a notice, replacing any showing now. Returns its id, for dismissing that one only. */
export function showAppNotice(notice: {
  message: string;
  tone?: AppNotice["tone"];
  action?: AppNotice["action"];
  durationMs?: number;
}): number {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  const id = nextId++;
  current = {
    id,
    message: notice.message,
    tone: notice.tone ?? "info",
    ...(notice.action ? { action: notice.action } : {}),
    durationMs: notice.durationMs ?? DEFAULT_NOTICE_MS,
  };
  if (current.durationMs > 0) {
    timer = setTimeout(() => dismissAppNotice(id), current.durationMs);
  }
  emit();
  return id;
}

/** Hides the notice; with an id, only if that notice is still the one showing. */
export function dismissAppNotice(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  current = null;
  emit();
}
