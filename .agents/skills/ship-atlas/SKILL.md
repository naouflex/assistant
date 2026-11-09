---
name: ship-atlas
description: >-
  Deploy Atlas to production and build the Windows installer and Android APK
  from a WSL checkout. Use when the user asks to deploy, ship, go live, merge
  into prod, or rebuild the exe, installer, desktop app, or APK.
---

# Ship Atlas

Run only what the user asked for. Build from an up-to-date `main` unless told otherwise:

```bash
git checkout main && git pull --ff-only && pnpm install --frozen-lockfile
```

## Deploy to production

`update` builds from the code already on the VM, so always `upload` first. Skipping it redeploys the previous release and still reports success.

```bash
infra/compose/deploy-apps-prod.sh upload
infra/compose/deploy-apps-prod.sh update
infra/compose/deploy-apps-prod.sh verify   # prints {"ok":true}
```

Done when `verify` passes **and** a line from the change is present in the running container (`docker exec <api container> grep -rl '<symbol>' /app/packages`).

## Windows installer (from WSL)

electron-builder wants Wine for the Windows steps; `wsl-wine` stands in for it and runs the Windows tools natively through WSL interop.

```bash
SHIM=$(mktemp -d)
cp .agents/skills/ship-atlas/wsl-wine "$SHIM/wine" && cp "$SHIM/wine" "$SHIM/wine64"
pnpm --filter @atlas/web build
cd apps/desktop && pnpm build
PATH="$SHIM:$PATH" USE_SYSTEM_WINE=true npx electron-builder --win nsis --x64 --publish never
```

Output: `apps/desktop/out/Atlas Setup <version>.exe`, version from `apps/desktop/package.json`.

## Android APK

```bash
cd apps/mobile/android
export ANDROID_HOME=~/Android/Sdk JAVA_HOME=~/Android/jdk17 EXPO_PUBLIC_API_URL=https://atlas.naoufel.io
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2
```

Output: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`; name the copy `Atlas-<versionName>.apk` from `app/build.gradle`.

## Hand over

Copy builds to the Windows desktop:

```bash
DESK="$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")/Desktop"
```

Done when each file exists there with a fresh timestamp. Run the two builds one after the other, not in parallel: both are memory-heavy.
