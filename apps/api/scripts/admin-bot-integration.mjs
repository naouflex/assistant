#!/usr/bin/env node
/**
 * Disposable local Postgres + admin-bot integration (migrates, runs Vitest).
 * Usage: node apps/api/scripts/admin-bot-integration.mjs
 *
 * Requires: local PostgreSQL with `sudo -u postgres` peer auth, openssl, pnpm install.
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const dbName = `abt_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const roleName = `abt_${randomBytes(4).toString("hex")}`;
const password = randomBytes(16).toString("hex");
const encryptionKey = randomBytes(32).toString("hex");

function psql(sql) {
  execFileSync("sudo", ["-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    stdio: "inherit",
  });
}

try {
  const safePw = password.replace(/'/g, "''");
  psql(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN CREATE ROLE "${roleName}" LOGIN PASSWORD '${safePw}' NOSUPERUSER NOBYPASSRLS; END IF; END $$;`,
  );
  psql(`CREATE DATABASE "${dbName}" OWNER "${roleName}"`);
  psql(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rakazo_app') THEN CREATE ROLE rakazo_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF; END $$;`,
  );

  const dbUrl = `postgresql://${encodeURIComponent(roleName)}:${encodeURIComponent(password)}@127.0.0.1:5432/${encodeURIComponent(dbName)}`;
  const dbPackageDir = execFileSync("pnpm", ["--filter", "@atlas/db", "exec", "pwd"], {
    encoding: "utf8",
    cwd: root,
  }).trim();

  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: dbPackageDir,
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      DATABASE_MIGRATION_URL: dbUrl,
    },
  });

  execFileSync(
    "pnpm",
    [
      "--filter",
      "@atlas/api",
      "exec",
      "vitest",
      "run",
      "apps/api/src/cli/admin-bot.postgres.test.ts",
      "apps/api/src/cli/admin-bot.redact.test.ts",
      "--root",
      "../..",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        VERIFY_DATABASE: "1",
        DATABASE_URL: dbUrl,
        DATABASE_MIGRATION_URL: dbUrl,
        ENCRYPTION_KEY: encryptionKey,
        CONTENT_ENCRYPTION: "on",
        NODE_ENV: "test",
      },
    },
  );
} finally {
  try {
    psql(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName.replace(/'/g, "''")}' AND pid <> pg_backend_pid()`,
    );
  } catch {
    // ignore
  }
  try {
    psql(`DROP DATABASE IF EXISTS "${dbName}"`);
  } catch {
    // ignore
  }
  try {
    psql(`DROP ROLE IF EXISTS "${roleName}"`);
  } catch {
    // ignore
  }
}
