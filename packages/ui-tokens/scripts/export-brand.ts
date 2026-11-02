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

/** The mountain alone on transparent. App icons are the triangle, not a plate around it. */
const mark = appIcon.replace(/\s*<rect [^>]*\/>/, "");

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
  const frames = await Promise.all(sizes.map((size) => render(mark, size).png().toBuffer()));
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
  await png(mark, `${publicDir}/favicon-16x16.png`, 16);
  await png(mark, `${publicDir}/favicon-32x32.png`, 32);
  await png(mark, `${publicDir}/favicon.png`, 128);
  await png(mark, `${publicDir}/apple-touch-icon.png`, 180);
  await png(mark, `${publicDir}/icon-192.png`, 192);
  await png(mark, `${publicDir}/icon-512.png`, 512);
  await ico(`${publicDir}/favicon.ico`, [16, 32, 48]);
}
await mkdir(path("apps/www/public/brand"), { recursive: true });
await png(mark, "apps/www/public/brand/atlas-mark.png", 256);
await render(wordmarkDark, 1110, 320)
  .png()
  .toFile(path("apps/www/public/brand/atlas-wordmark-dark.png"));
await render(wordmarkLight, 1110, 320)
  .png()
  .toFile(path("apps/www/public/brand/atlas-wordmark-light.png"));
await png(mark, "apps/mobile/assets/favicon.png", 128);
await png(mark, "apps/desktop/assets/icon.png", 1024);
await ico("apps/desktop/assets/icon.ico", [16, 32, 48, 64, 128, 256]);

// Icon Composer source: the mountain is the only layer, and icon.json leaves the fill clear.
await png(mark, "packages/ui-tokens/assets/Atlas.icon/Assets/atlas-globe.png", 1024);

// macOS pre-Tahoe development icon. The mountain already sits inside the canvas.
await png(mark, "apps/desktop/assets/icon-macos.png", 1024);

// Expo / Android. Launchers paint a clear adaptive background black (Pixel does), so the ink
// mountain gets a cream rim that keeps it visible on black and on light or dark wallpapers
// without a solid plate. Adaptive layers are 108dp and the mask can crop anything outside the
// central 66dp circle, so launcher art is scaled to sit inside that safe zone.
const MOBILE_RIM = "#F7F4EF";
const SAFE_ZONE_SCALE = 0.5;
const mountainPath = /<path fill="#141210" d="([^"]+)"/.exec(appIcon)?.[1];
const markArt = /<g transform="scale\(2\)">([\s\S]*?)<\/g>/.exec(appIcon)?.[1];
const monochromeArt = /<g transform="scale\(2\)">([\s\S]*?)<\/g>/.exec(monochrome)?.[1];
if (!mountainPath || !markArt || !monochromeArt) throw new Error("Brand SVG layout changed.");

/** The 512-unit mountain artwork centred on a 1024 canvas at `scale` of the canvas width. */
function mobileCanvas(scale: number, body: string, defs = "") {
  const transform = `translate(512 512) scale(${2 * scale}) translate(-256 -256)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${defs}<g transform="${transform}">${body}</g></svg>`;
}
/** Ink mountain with a cream rim, on transparent. */
const rimmedMark = (scale: number) =>
  mobileCanvas(
    scale,
    `<path d="${mountainPath}" fill="${MOBILE_RIM}" stroke="${MOBILE_RIM}" stroke-width="44" stroke-linejoin="round"/>${markArt}`,
  );
/** Single-colour white silhouette with the snow and eyes cut out (themed and notification icons). */
function silhouetteMark(scale: number) {
  const transform = `translate(512 512) scale(${2 * scale}) translate(-256 -256)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><mask id="atlas-knockout"><g transform="${transform}">${monochromeArt}</g></mask><rect width="1024" height="1024" fill="#FFFFFF" mask="url(#atlas-knockout)"/></svg>`;
}

// The legacy icon (pre-Android 8 and some third-party launchers) is the rimmed mountain on clear.
await png(rimmedMark(0.9), "apps/mobile/assets/icon.png", 1024);
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .png()
  .toFile(path("apps/mobile/assets/icon-background.png"));
await png(rimmedMark(SAFE_ZONE_SCALE), "apps/mobile/assets/adaptive-icon.png", 1024);
await png(silhouetteMark(SAFE_ZONE_SCALE), "apps/mobile/assets/monochrome-icon.png", 1024);
const splashPad = { top: 202, bottom: 202, left: 202, right: 202, background: "#00000000" };
await render(mark, 620).extend(splashPad).png().toFile(path("apps/mobile/assets/splash-icon.png"));
await render(monochrome, 620)
  .extend(splashPad)
  .png()
  .toFile(path("apps/mobile/assets/splash-icon-dark.png"));

// Android notification icons must be white alpha silhouettes with a little padding.
const silhouette = await render(silhouetteMark(0.84), 96).extractChannel("alpha").toBuffer();
await sharp({ create: { width: 96, height: 96, channels: 3, background: "white" } })
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
