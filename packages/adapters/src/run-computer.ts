import type { ComputerRef } from "@atlas/adapter-kit";

/** How long after a bot last used its computer a new chat turn starts it early. */
export const COMPUTER_PREWARM_RECENT_MS = 2 * 60 * 60_000;
const MAX_TRACKED_COMPUTERS = 10_000;
const lastComputerUse = new Map<string, number>();

/** A tool on this computer ran; the next chat turn may start the computer early. */
export function noteComputerUsed(computerId: string, now = Date.now()): void {
  lastComputerUse.delete(computerId);
  lastComputerUse.set(computerId, now);
  if (lastComputerUse.size > MAX_TRACKED_COMPUTERS) {
    const oldest = lastComputerUse.keys().next().value;
    if (oldest !== undefined) lastComputerUse.delete(oldest);
  }
}

/** Test seam: forget every recorded use. */
export function resetComputerUseHints(): void {
  lastComputerUse.clear();
}

/**
 * Whether to start a run's computer alongside its first model call instead of waiting for a
 * tool. Only for an owner's chat turn on a cloud computer that a tool used recently, so a
 * start the turn turns out not to need stays rare. The hint is per process and only ever
 * decides timing: without it the computer still starts on first use.
 */
export function shouldPrewarmComputer(
  input: {
    computerId: string;
    kind: string;
    state: string;
    trigger: string;
    heldForTakeover: boolean;
  },
  now = Date.now(),
): boolean {
  if (input.trigger !== "user" || input.heldForTakeover) return false;
  if (input.kind === "desktop" || input.state === "quarantined") return false;
  const usedAt = lastComputerUse.get(input.computerId);
  return usedAt !== undefined && now - usedAt < COMPUTER_PREWARM_RECENT_MS;
}

/**
 * A run's computer, started the first time a tool needs it.
 *
 * Remote computers bill while they run, so a run that never touches its computer must not
 * create or resume one. A failed start is kept: every later use rethrows it as a setup failure.
 * `prewarm` starts it early; a failed early start is not kept, and the first real use tries
 * again with the usual failure handling.
 */
export function lazyRunComputer(start: () => Promise<ComputerRef>, onFailure?: () => void) {
  let started: Promise<ComputerRef> | undefined;
  let warming: Promise<ComputerRef> | undefined;
  let ready: ComputerRef | undefined;
  let failed = false;
  let failure: unknown;
  const attempt = () =>
    start().then(
      (computer) => {
        ready = computer;
        return computer;
      },
      (error: unknown) => {
        failed = true;
        failure = error;
        onFailure?.();
        throw error;
      },
    );
  return {
    get(): Promise<ComputerRef> {
      started ??= warming ? warming.catch(() => attempt()) : attempt();
      return started;
    },
    /** Start now without waiting; a failure here is left for the first real use to retry. */
    prewarm(): void {
      if (started || warming) return;
      warming = start().then((computer) => {
        ready = computer;
        return computer;
      });
      warming.catch(() => undefined);
    },
    /** The computer if a tool already started it. */
    get ready(): ComputerRef | undefined {
      return ready;
    },
    throwIfFailed(): void {
      if (failed) throw failure;
    },
  };
}
