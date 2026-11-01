# Desktop icons

The shared logo sources and export notes are in
[`packages/ui-tokens/assets`](../../../packages/ui-tokens/assets/README.md).

Mac packaging requires Xcode 26 or newer. Electron builder compiles `Atlas.icon`
into `Assets.car` for Tahoe and generates `icon.icns` for older macOS versions.
`icon-macos.png` is the matching development export of the mountain.

`icon.png` and `icon.ico` are the Linux and Windows exports of the Atlas app icon.
Refresh them with `pnpm --filter @atlas/ui-tokens export:brand`.
