import { build } from "esbuild";

// One file that runs on plain Node, so a machine needs nothing but Node to become a computer.
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/atlas-device.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  // Native addons only the desktop's screen control loads.
  external: ["koffi", "sharp"],
});
