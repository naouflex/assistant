import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = new URL("../../../", import.meta.url);
const path = (name: string) => fileURLToPath(new URL(name, root));
const brand = (name: string) => path(`packages/ui-tokens/assets/brand/${name}`);

// Every raster export comes from the hand-authored SVGs in assets/brand.
const appIcon = await readFile(brand("atlas-app-icon.svg"), "utf8");
const monochrome = await readFile(brand("atlas-mark-monochrome.svg"), "utf8");
const wordmarkDark = await readFile(brand("atlas-wordmark-dark.svg"), "utf8");
const wordmarkLight = await readFile(brand("atlas-wordmark-light.svg"), "utf8");

/** The plate's rounded corners, as drawn for browsers, Windows, Linux and the splash. */
const rounded = appIcon;
/** Full-bleed plate for platforms that apply their own mask (iOS, PWA, apple-touch). */
const square = appIcon.replace('rx="224"', 'rx="0"');
/** The mountain alone on transparent, positioned exactly as on the plate. */
const foreground = appIcon.replace(/\s*<rect [^>]*\/>/, "");

function render(svg: string, width: number, height = width) {
  const intrinsic = Number(/width="(\d+)"/.exec(svg)?.[1] ?? width);
  return sharp(Buffer.from(svg), { density: Math.max(72, (72 * width * 2) / intrinsic) }).resize(
    width,
    height,
  );
}

async function png(svg: string, name: string, size: number) {
  await render(svg, size).png().toFile(path(name));
}

// PNG frames in ICO are supported by modern Windows and browser favicon loaders.
async function ico(name: string, sizes: number[]) {
  const frames = await Promise.all(
    sizes.map((size) =>
      render(rounded, size)
        .png()
        .toBuffer(),
    ),
  );
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await writeFile(path(name), Buffer.concat([header, ...frames]));
}

for (const app of ["web", "www"]) {
  const publicDir = `apps/${app}/public`;
  await png(rounded, `${publicDir}/favicon-16x16.png`, 16);
  await png(rounded, `${publicDir}/favicon-32x32.png`, 32);
  await png(rounded, `${publicDir}/favicon.png`, 128);
  await png(square, `${publicDir}/apple-touch-icon.png`, 180);
  await png(square, `${publicDir}/icon-192.png`, 192);
  await png(square, `${publicDir}/icon-512.png`, 512);
  await ico(`${publicDir}/favicon.ico`, [16, 32, 48]);
}
await mkdir(path("apps/www/public/brand"), { recursive: true });
await png(rounded, "apps/www/public/brand/atlas-mark.png", 256);
await render(wordmarkDark, 1110, 320)
  .png()
  .toFile(path("apps/www/public/brand/atlas-wordmark-dark.png"));
await render(wordmarkLight, 1110, 320)
  .png()
  .toFile(path("apps/www/public/brand/atlas-wordmark-light.png"));
await png(rounded, "apps/mobile/assets/favicon.png", 128);
await png(rounded, "apps/desktop/assets/icon.png", 1024);
await ico("apps/desktop/assets/icon.ico", [16, 32, 48, 64, 128, 256]);

// Icon Composer source: the mountain is the only layer; icon.json supplies the plate colour.
await png(foreground, "packages/ui-tokens/assets/Atlas.icon/Assets/atlas-globe.png", 1024);

// macOS pre-Tahoe development icon: an 824-point plate inside the 1024 canvas, as the Dock expects.
const plate = await render(appIcon.replace('rx="224"', 'rx="185"'), 824).png().toBuffer();
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#00000000" } })
  .composite([{ input: plate, top: 100, left: 100 }])
  .png()
  .toFile(path("apps/desktop/assets/icon-macos.png"));

// Expo: opaque legacy icon, Android adaptive layers and the splash.
await render(square, 1024)
  .flatten({ background: "#F7F4EF" })
  .png()
  .toFile(path("apps/mobile/assets/icon.png"));
await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#F7F4EF" } })
  .png()
  .toFile(path("apps/mobile/assets/icon-background.png"));
// The mountain stays inside the launcher's 66% safe zone at full size.
await png(foreground, "apps/mobile/assets/adaptive-icon.png", 1024);
await png(monochrome, "apps/mobile/assets/monochrome-icon.png", 1024);
// The splash shows the plated icon so it reads on both the light and dark splash colours.
await render(rounded, 620)
  .extend({ top: 202, bottom: 202, left: 202, right: 202, background: "#00000000" })
  .png()
  .toFile(path("apps/mobile/assets/splash-icon.png"));

// Android notification icons must be white alpha silhouettes.
const silhouette = await sharp(path("apps/mobile/assets/monochrome-icon.png"))
  .resize(72, 72)
  .extractChannel("alpha")
  .toBuffer();
await sharp({ create: { width: 72, height: 72, channels: 3, background: "white" } })
  .joinChannel(silhouette)
  .png()
  .toFile(path("apps/mobile/assets/notification-icon.png"));

// Default social card for the marketing site; per-page cards come from apps/www/scripts/render-og.mjs.
const ogWordmark = await render(wordmarkDark, 740, 213).png().toBuffer();
const ogText = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><text x="600" y="500" text-anchor="middle" font-family="Inter, Helvetica, Arial, DejaVu Sans, sans-serif" font-size="40" fill="#BFB6A8">AI teammates you actually own</text></svg>',
);
await sharp({ create: { width: 1200, height: 630, channels: 4, background: "#0E0D0C" } })
  .composite([
    { input: ogWordmark, left: 230, top: 170 },
    { input: ogText, left: 0, top: 0 },
  ])
  .png()
  .toFile(path("apps/www/public/og-image.png"));
