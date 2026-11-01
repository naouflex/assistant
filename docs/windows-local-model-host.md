# Windows local model host

Atlas Desktop on Windows can run a **native CUDA** `llama-server` for best GPU
performance (RTX-class cards). The API may still live in WSL; the model process
runs on Windows.

## What the EXE does

1. Installs the official ggml-org Windows **CUDA 12.4** `llama-server` build into
   the app user data folder (`%LOCALAPPDATA%\Atlas\llama-host\runtime`).
2. Obtains **Qwen3.5 4B MTP** by copying from WSL when present
   (`\\wsl$\Ubuntu-24.04\home\…\llama-standalone\models\…`), otherwise downloads
   from Hugging Face.
3. Starts the server on port **11436** (override with `ATLAS_LOCAL_MODELS_PORT`)
   bound to **0.0.0.0** so WSL can reach it (override with `ATLAS_LOCAL_MODELS_HOST`).

Controls live in **Settings → Devices → Local model** (Start / Stop).

## Point the WSL API at Windows CUDA

In the WSL Atlas `.env`:

```bash
# Windows host IP as seen from WSL (often the resolv.conf nameserver)
ATLAS_LOCAL_MODELS_URL=http://$(grep nameserver /etc/resolv.conf | awk '{print $2}'):11436/v1
```

Or set a fixed Tailscale / LAN IP for the Windows side. Restart the API after
changing it. Devices → Models should then show the Windows host as online.

## Pack an unsigned installer

From the worktree (keep Gradle/Electron workers at 2; watch free space on `C:`):

```bash
cd apps/desktop
pnpm build
pnpm exec electron-builder --win nsis --publish never -c.win.signAndEditExecutable=false
```

The NSIS installer lands under `apps/desktop/out/`. Signing is skipped for local
personal builds.
