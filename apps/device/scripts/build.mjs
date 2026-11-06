import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

// Native addons cannot be bundled; `npm install` next to the bundle fetches them.
const native = ["koffi"];
const adapters = JSON.parse(await readFile("../../packages/adapters/package.json", "utf8"));

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
  // sharp is only loaded by tools that never run on a paired computer.
  external: [...native, "sharp"],
});

await writeFile(
  "dist/package.json",
  `${JSON.stringify(
    {
      name: "atlas-device",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(native.map((name) => [name, adapters.dependencies[name]])),
    },
    null,
    2,
  )}\n`,
);
