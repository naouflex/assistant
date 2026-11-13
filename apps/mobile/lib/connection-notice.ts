/**
 * Says when the server stops answering, after a short grace so a blip stays quiet, and that it
 * is back once it answers again. While it is down, a health probe backs off from 5 s to 30 s,
 * so the app notices recovery even when no screen is retrying.
 */
export const OFFLINE_GRACE_MS = 3_000;
export const FIRST_PROBE_MS = 5_000;
export const MAX_PROBE_MS = 30_000;
export const BACK_ONLINE_NOTICE_MS = 2_500;

export type ConnectionNoticeDeps = {
  isReachable: () => boolean;
  subscribe: (listener: () => void) => () => void;
  probe: () => Promise<unknown>;
  showOffline: () => number;
  showBackOnline: () => number;
  dismiss: (id: number) => void;
  /** False while the app is in the background: no probing then. */
  isActive: () => boolean;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
};

export function createConnectionNotice(deps: ConnectionNoticeDeps) {
  let graceTimer: unknown;
  let probeTimer: unknown;
  let probeMs = FIRST_PROBE_MS;
  let offlineNotice: number | null = null;

  const clear = (timer: unknown) => {
    if (timer !== undefined) deps.clearTimer(timer);
  };

  const scheduleProbe = () => {
    clear(probeTimer);
    probeTimer = deps.setTimer(() => {
      probeTimer = undefined;
      if (deps.isReachable()) return;
      if (deps.isActive()) void deps.probe().catch(() => undefined);
      probeMs = Math.min(probeMs * 2, MAX_PROBE_MS);
      scheduleProbe();
    }, probeMs);
  };

  const sync = () => {
    if (deps.isReachable()) {
      clear(graceTimer);
      clear(probeTimer);
      graceTimer = probeTimer = undefined;
      probeMs = FIRST_PROBE_MS;
      if (offlineNotice !== null) {
        deps.dismiss(offlineNotice);
        offlineNotice = null;
        deps.showBackOnline();
      }
      return;
    }
    if (graceTimer !== undefined || offlineNotice !== null) return;
    graceTimer = deps.setTimer(() => {
      graceTimer = undefined;
      if (deps.isReachable()) return;
      offlineNotice = deps.showOffline();
    }, OFFLINE_GRACE_MS);
    scheduleProbe();
  };

  const unsubscribe = deps.subscribe(sync);
  sync();
  return {
    /** Back in the foreground: check now rather than at the next backed-off probe. */
    resumed(): void {
      if (deps.isReachable()) return;
      probeMs = FIRST_PROBE_MS;
      void deps.probe().catch(() => undefined);
      scheduleProbe();
    },
    dispose(): void {
      unsubscribe();
      clear(graceTimer);
      clear(probeTimer);
      if (offlineNotice !== null) deps.dismiss(offlineNotice);
    },
  };
}
