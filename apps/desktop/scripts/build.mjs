import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  external: ["electron", "electron-updater", "koffi", "@sentry/electron"],
  // Only the release workflow's builds report errors; local and agent builds never do.
  define: {
    // monitoring.ts reads the Atlas name; the upstream name still works for older scripts.
    "process.env.ATLAS_DESKTOP_RELEASE": JSON.stringify(
      process.env.ATLAS_DESKTOP_RELEASE ?? process.env.RAKAZO_DESKTOP_RELEASE ?? "",
    ),
    // Self-hosted builds associated with their own passkey domain (see src/passkeys.ts).
    "process.env.ATLAS_PASSKEY_RP_ID": JSON.stringify(
      process.env.ATLAS_PASSKEY_RP_ID ?? process.env.RAKAZO_PASSKEY_RP_ID ?? "",
    ),
    "process.env.RAKAZO_PASSKEY_RP_ID": JSON.stringify(process.env.RAKAZO_PASSKEY_RP_ID ?? ""),
  },
});
