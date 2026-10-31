# Brand assets

## Logo sources

The Atlas logo is a line-art globe (outer circle, one straight and two curved
meridians) resting on a short bar. The stroke runs from warm white (`#FFF8EE`) at
the top left to amber (`#F0B35A`) at the bottom right. The app icon puts it on a
near-black (`#0E0D0C`) rounded square.

The hand-authored SVGs in [`brand/`](./brand) are the only sources:

- `atlas-mark.svg`: the globe on a transparent background.
- `atlas-mark-monochrome.svg`: the white silhouette used for Android themed and
  notification icons.
- `atlas-app-icon.svg`: the globe on the near-black rounded square.
- `atlas-wordmark-dark.svg`: globe and "Atlas" for dark backgrounds.
- `atlas-wordmark-light.svg`: globe and "Atlas" for light backgrounds.

The wordmark letters are drawn as monoline paths, so the SVGs render the same
without any font installed.

## Exports

Run `pnpm --filter @atlas/ui-tokens export:brand` after changing a source. It
rewrites every raster at its existing path:

- web and marketing favicons (`favicon.ico`, 16, 32 and 128 px PNGs), apple-touch,
  PWA icons (192 and 512 px) and `apps/www/public/brand/atlas-mark.png`, plus PNG
  wordmarks next to it;
- `apps/www/public/og-image.png`, the default social card;
- `apps/desktop/assets/icon.png`, `icon.ico` and `icon-macos.png` (the pre-Tahoe
  development export with Dock margins);
- `apps/mobile/assets/icon.png` (opaque, unmasked), `adaptive-icon.png`,
  `icon-background.png`, `monochrome-icon.png`, `notification-icon.png`,
  `splash-icon.png` and `favicon.png`;
- `Atlas.icon/Assets/atlas-globe.png`, the single layer of the Icon Composer
  source used for macOS and iOS. `icon.json` supplies the near-black fill.

Small browser icons use a heavier stroke so the meridians stay visible at 16 px.
Android supplies its own mask; never bake Mac corners, a rim, or an outer shadow
into the adaptive layers.

After exporting, run `pnpm exec tsx apps/www/scripts/render-og.mjs` to refresh the
per-page social cards; set `CHROME_PATH` to a headless Chrome executable when it
is not available at the script's default location.

## Mascot

[`mascot/orange-bot.png`](./mascot/orange-bot.png) is the orange character
inherited from Rakazo. It is no longer the app logo. It stays as the reference for
the animated "atlas" bot avatar set, whose SVG paths and gradients live in the
shared `logo-avatar-art.ts` definition and were sampled from its alpha silhouette.
