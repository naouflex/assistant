import { SandboxUnavailableError, SandboxUnresponsiveError } from "@atlas/adapter-kit";
import { abortableDelay } from "@atlas/core";
import { getLogger } from "@atlas/logging";
import { ComputerBusyError } from "./computer-lifecycle.js";

/** Waits between tries of a computer start that failed for a passing reason. */
export const COMPUTER_START_RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;

/** Connection drops and exec streams cut by the provider, not by the run. */
const TRANSIENT_MESSAGE =
  /command aborted|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|socket hang up|network error|connection (?:reset|closed|refused)|websocket (?:closed|error)|timed out waiting/i;

function httpStatus(error: object): number | undefined {
  for (const key of ["status", "statusCode", "code"] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

/**
 * A computer start that may succeed if tried again soon: another start holding the
 * computer, a provider that is briefly down, or a connection cut mid-setup. Limits,
 * quarantine, damage and configuration problems are not, so they fail at once.
 */
export function isTransientComputerStartError(error: unknown): boolean {
  if (error instanceof ComputerBusyError) return true;
  if (error instanceof SandboxUnresponsiveError || error instanceof SandboxUnavailableError)
    return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError" || error instanceof AggregateError) return false;
  const status = httpStatus(error);
  if (status !== undefined && status >= 400 && status < 600)
    return status >= 500 || status === 429 || status === 408 || status === 409;
  const code = (error as { code?: unknown }).code;
  return TRANSIENT_MESSAGE.test(
    typeof code === "string" ? `${code} ${error.message}` : error.message,
  );
}

/**
 * Starts a computer, trying again with backoff while the failure looks transient, so a
 * dropped connection during setup does not fail the whole run. An aborted signal stops
 * at once and rethrows the last failure.
 */
export async function startComputerWithRetry<T>(
  start: () => Promise<T>,
  options: {
    signal: AbortSignal;
    delaysMs?: readonly number[];
    computerId?: string;
  },
): Promise<T> {
  const delays = options.delaysMs ?? COMPUTER_START_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await start();
    } catch (error) {
      const delayMs = delays[attempt];
      if (delayMs === undefined || options.signal.aborted || !isTransientComputerStartError(error))
        throw error;
      getLogger().warn("computer.start_retry", {
        "computer.id": options.computerId,
        attempt: attempt + 1,
        delayMs,
        error,
      });
      await abortableDelay(delayMs, options.signal);
      if (options.signal.aborted) throw error;
    }
  }
}
