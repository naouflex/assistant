import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

const ATTEMPTS = 4;

/**
 * Every database URL the app and Prisma read, pointed at one disposable database.
 * Prisma migrates DATABASE_MIGRATION_URL first and reloads `.env`, so an inherited
 * one must be overwritten, not deleted.
 */
export function disposableDatabaseEnv(url: string) {
  return { DATABASE_URL: url, DATABASE_MIGRATION_URL: url, REALTIME_DATABASE_URL: url };
}

/** A disposable Postgres; image registries rate-limit shared CI runners per minute, so pulls are retried. */
export async function startPostgres(signal?: AbortSignal) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // A throwaway database needs no crash safety; parallel suites need more connections.
      return await new PostgreSqlContainer("postgres:18-alpine")
        .withCommand([
          "postgres",
          "-c",
          "fsync=off",
          "-c",
          "synchronous_commit=off",
          "-c",
          "full_page_writes=off",
          "-c",
          "max_connections=500",
        ])
        .start();
    } catch (error) {
      if (attempt === ATTEMPTS || signal?.aborted) throw error;
      const delaySeconds = attempt * 20;
      console.warn(`Postgres did not start (${String(error)}); retrying in ${delaySeconds}s`);
      await sleep(delaySeconds * 1000, undefined, { signal });
    }
  }
}

/** A database the CLI may migrate and evaluate against, then discard. */
export interface DisposablePostgres {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}

/**
 * ATLAS_TEST_POSTGRES_URL points at a server the developer owns (no container runtime needed):
 * each run gets a fresh, uniquely named database there, which Prisma creates on migrate and
 * `stop` drops. Otherwise a disposable container starts as usual.
 */
export async function startDisposablePostgres(signal?: AbortSignal): Promise<DisposablePostgres> {
  const server = process.env.ATLAS_TEST_POSTGRES_URL?.trim();
  if (!server) return startPostgres(signal);
  const url = new URL(server);
  const name = `atlas_eval_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
  const admin = new URL(url);
  admin.pathname = "/postgres";
  url.pathname = `/${name}`;
  return {
    getConnectionUri: () => url.toString(),
    stop: () =>
      new Promise<void>((resolve) => {
        // Best effort: a leftover database only costs disk on the developer's own server.
        execFile("psql", [admin.toString(), "-qc", `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`], () =>
          resolve(),
        );
      }),
  };
}
