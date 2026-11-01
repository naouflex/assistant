import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import path from "node:path";
import type { DesktopLocalModelHostState } from "@atlas/contracts";

/** Pinned official Windows CUDA 12.4 build; override with ATLAS_LLAMA_RELEASE. */
export const DEFAULT_LLAMA_RELEASE = "b12032";

export const DEFAULT_MODEL_ID = "qwen3.5:4b-mtp";

export type LocalModelCatalogEntry = {
  id: string;
  label: string;
  filename: string;
  /** Hugging Face resolve URL when no local import is available. */
  downloadUrl: string;
  /** Optional mmproj for vision; omitted when unused. */
  mmprojFilename?: string;
  mmprojDownloadUrl?: string;
  /** Known WSL paths to copy from (fast path on this machine). */
  importPaths: string[];
  /** Router model id when it differs from `id`. */
  servedAs?: string;
  /** Extra names the router should answer for this file. */
  aliases?: readonly string[];
  /** Per-model llama-server preset keys. Shared flags live in the preset header. */
  args: Readonly<Record<string, string>>;
};

const QWEN_FILENAME = "Qwen3.5-4B-MTP-Q4_K_M.gguf";
const SPARK_25_MODEL_ID = "spark-x2.5:4b";
const SPARK_25_FILENAME = "Spark-X2.5-4B-Q4_K_M.gguf";
const SPARK_26_MODEL_ID = "spark-x2.6:4b";
const SPARK_26_FILENAME = "Spark-X2.6-4B-Q4_K_M.gguf";
const QWEN_9B_MODEL_ID = "qwen3.5:9b";
const QWEN_9B_FILENAME = "Qwen3.5-9B-Q4_K_M.gguf";
const QWEN_38_9B_MODEL_ID = "qwen3.8:9b";
const QWEN_38_9B_FILENAME = "Qwen3.8-9B-Q4_K_M.gguf";

export const LOCAL_MODEL_CATALOG: readonly LocalModelCatalogEntry[] = [
  {
    id: DEFAULT_MODEL_ID,
    label: "Qwen3.5 4B MTP",
    filename: QWEN_FILENAME,
    downloadUrl:
      "https://huggingface.co/localweights/Qwen3.5-4B-MTP-Q4_K_M-GGUF/resolve/main/Qwen3.5-4B-MTP-Q4_K_M.gguf",
    mmprojFilename: "mmproj-Qwen3.5-4B-F16.gguf",
    mmprojDownloadUrl:
      "https://huggingface.co/Qwen/Qwen3.5-4B-GGUF/resolve/main/mmproj-Qwen3.5-4B-F16.gguf",
    importPaths: [
      // Fast path: copy the GGUF already on this PC's WSL install.
      "\\\\wsl$\\Ubuntu-24.04\\home\\naoufel\\.local\\llama-standalone\\models\\Qwen3.5-4B-MTP-Q4_K_M.gguf",
      "\\\\wsl.localhost\\Ubuntu-24.04\\home\\naoufel\\.local\\llama-standalone\\models\\Qwen3.5-4B-MTP-Q4_K_M.gguf",
    ],
    // The router publishes the section as qwen3.5:4B, so the old lowercase id stays an alias.
    servedAs: "qwen3.5:4b",
    aliases: ["qwen3.5:4b", "qwen3.5:4b-mtp"],
    args: {
      "ctx-size": "16384",
      parallel: "2",
      "kv-unified": "true",
      "spec-type": "draft-mtp",
      "spec-draft-n-max": "3",
      reasoning: "off",
      "load-on-startup": "true",
    },
  },
  {
    id: QWEN_9B_MODEL_ID,
    label: "Qwen3.5 9B",
    filename: QWEN_9B_FILENAME,
    downloadUrl:
      "https://huggingface.co/unsloth/Qwen3.5-9B-MTP-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
    importPaths: [],
    // The router publishes the section as qwen3.5:9B. The text alias is the id older chats saved.
    servedAs: "qwen3.5:9b",
    aliases: ["qwen3.5:9b", "qwen3.5:9b-text"],
    args: {
      "ctx-size": "16384",
      parallel: "1",
      "kv-unified": "true",
      "cache-type-k": "q8_0",
      "cache-type-v": "q8_0",
      "spec-type": "draft-mtp",
      "spec-draft-n-max": "2",
      reasoning: "off",
      temp: "0.7",
      "top-k": "20",
      "top-p": "0.8",
      "min-p": "0",
      "presence-penalty": "1.5",
    },
  },
  {
    id: QWEN_38_9B_MODEL_ID,
    label: "Qwen3.8 9B",
    filename: QWEN_38_9B_FILENAME,
    downloadUrl:
      "https://huggingface.co/empero-ai/Qwen3.8-9B-Distill-GGUF/resolve/main/Qwen3.8-9B-Q4_K_M.gguf",
    importPaths: [],
    servedAs: "qwen3.8:9b",
    aliases: ["qwen3.8:9b"],
    args: {
      "ctx-size": "16384",
      parallel: "1",
      "kv-unified": "true",
      "cache-type-k": "q8_0",
      "cache-type-v": "q8_0",
      reasoning: "off",
      temp: "0.7",
      "top-k": "20",
      "top-p": "0.8",
      "min-p": "0",
      "presence-penalty": "1.5",
    },
  },
  {
    id: SPARK_25_MODEL_ID,
    label: "Spark-X2.5 4B",
    filename: SPARK_25_FILENAME,
    downloadUrl:
      "https://huggingface.co/XHToken/Spark-X2.5-4B-GGUF/resolve/main/Spark-X2.5-4B-Q4_K_M.gguf",
    importPaths: [],
    args: {
      // The GGUF advertises a 1M context; leave that unset and llama.cpp tries to allocate it.
      "ctx-size": "16384",
      parallel: "1",
      reasoning: "off",
      "no-reasoning-preserve": "true",
      temp: "1.0",
      "top-k": "0",
      "top-p": "0.95",
    },
  },
  {
    id: SPARK_26_MODEL_ID,
    label: "Spark-X2.6 4B",
    filename: SPARK_26_FILENAME,
    downloadUrl:
      "https://huggingface.co/XHToken/Spark-X2.6-4B-GGUF/resolve/main/Spark-X2.6-4B-Q4_K_M.gguf",
    importPaths: [],
    args: {
      "ctx-size": "16384",
      parallel: "1",
      reasoning: "off",
      "no-reasoning-preserve": "true",
      temp: "1.0",
      "top-k": "0",
      "top-p": "0.95",
    },
  },
];

/** INI preset for llama-server router mode. One section per catalog model. */
export function localModelRouterPreset(
  modelsDirectory: string,
  fileReady: (filename: string) => boolean = () => true,
): string {
  const lines = [
    "version = 1",
    "",
    "[*]",
    "flash-attn = on",
    "fit = off",
    "n-gpu-layers = 99",
    "jinja = true",
    "",
  ];
  for (const entry of LOCAL_MODEL_CATALOG) {
    lines.push(`[${entry.servedAs ?? entry.id}]`);
    lines.push(`model = ${presetPath(path.join(modelsDirectory, entry.filename))}`);
    if (entry.mmprojFilename && fileReady(entry.mmprojFilename)) {
      lines.push(`mmproj = ${presetPath(path.join(modelsDirectory, entry.mmprojFilename))}`);
    }
    if (entry.aliases?.length) lines.push(`alias = ${entry.aliases.join(",")}`);
    for (const [key, value] of Object.entries(entry.args)) lines.push(`${key} = ${value}`);
    lines.push("");
  }
  return lines.join("\n");
}

function presetPath(file: string): string {
  return file.replaceAll("\\", "/");
}

export function llamaReleaseTag(env: NodeJS.ProcessEnv = process.env): string {
  return env.ATLAS_LLAMA_RELEASE?.trim() || DEFAULT_LLAMA_RELEASE;
}

export function runtimeZipUrl(tag = llamaReleaseTag()): string {
  return `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-win-cuda-12.4-x64.zip`;
}

export function cudartZipUrl(tag = llamaReleaseTag()): string {
  return `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/cudart-llama-bin-win-cuda-12.4-x64.zip`;
}

export function hostRoot(userDataDir: string): string {
  return path.join(userDataDir, "llama-host");
}

export function modelsDir(root: string): string {
  return path.join(root, "models");
}

export function runtimeDir(root: string): string {
  return path.join(root, "runtime");
}

export function serverPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ATLAS_LOCAL_MODELS_PORT ?? 11436);
  return Number.isInteger(raw) && raw >= 1024 && raw <= 65535 ? raw : 11436;
}

/** Bind address for llama-server. Default 0.0.0.0 so a WSL Atlas API can reach Windows CUDA. */
export function serverHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.ATLAS_LOCAL_MODELS_HOST?.trim();
  return host || "0.0.0.0";
}

export function isWindowsNativeHostSupported(
  plat: NodeJS.Platform = platform(),
  cpu: string = arch(),
): boolean {
  return plat === "win32" && cpu === "x64";
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number | null) => void,
): Promise<void> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body)
    throw new Error(`Download failed (${response.status}) for ${url}`);
  const total = Number(response.headers.get("content-length") || 0) || null;
  const tmp = `${dest}.part`;
  await mkdir(path.dirname(dest), { recursive: true });
  const file = createWriteStream(tmp);
  let received = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      file.write(Buffer.from(chunk.value));
      onProgress?.(received, total);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      file.end((error: Error | null | undefined) => (error ? reject(error) : resolve())),
    );
  }
  await rename(tmp, dest);
}

async function expandZip(zipPath: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
      ],
      { windowsHide: true },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Expand-Archive exited ${code}`)),
    );
  });
}

async function findServerBinary(root: string): Promise<string | null> {
  const candidates = [
    path.join(root, "llama-server.exe"),
    path.join(root, "bin", "llama-server.exe"),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  // CUDA zips nest the binary one folder down; walk one level.
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(root, entry.name, "llama-server.exe");
    if (await exists(nested)) return nested;
  }
  return null;
}

export type LocalModelHostDeps = {
  userDataDir: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/**
 * Windows-native CUDA llama-server host: install runtime, obtain catalog models
 * (prefer a WSL copy), start/stop, and report health for Devices.
 */
export function createLocalModelHost(deps: LocalModelHostDeps) {
  const root = hostRoot(deps.userDataDir);
  const models = modelsDir(root);
  const runtime = runtimeDir(root);
  const port = serverPort();
  const primary = LOCAL_MODEL_CATALOG[0]!;
  let child: ChildProcessWithoutNullStreams | null = null;
  let phase: DesktopLocalModelHostState["phase"] = "idle";
  let message: string | null = null;
  let progress: number | null = null;
  let listeners = new Set<(state: DesktopLocalModelHostState) => void>();

  function emit() {
    const state = snapshot();
    for (const listener of listeners) listener(state);
  }

  function setState(
    next: DesktopLocalModelHostState["phase"],
    nextMessage: string | null = null,
    nextProgress: number | null = null,
  ) {
    phase = next;
    message = nextMessage;
    progress = nextProgress;
    emit();
  }

  async function modelReady(): Promise<boolean> {
    for (const entry of LOCAL_MODEL_CATALOG) {
      if (!(await exists(path.join(models, entry.filename)))) return false;
    }
    return true;
  }

  async function runtimeReady(): Promise<boolean> {
    return Boolean(await findServerBinary(runtime));
  }

  async function health(): Promise<boolean> {
    try {
      const response = await (deps.fetchImpl ?? fetch)(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  function snapshot(): DesktopLocalModelHostState {
    return {
      supported: isWindowsNativeHostSupported(),
      phase,
      message,
      progress,
      port,
      modelId: primary.id,
      modelLabel: LOCAL_MODEL_CATALOG.map((entry) => entry.label).join(", "),
      modelReady: false,
      runtimeReady: false,
      online: false,
      baseUrl: `http://127.0.0.1:${port}/v1`,
    };
  }

  async function refreshFacts(
    state: DesktopLocalModelHostState,
  ): Promise<DesktopLocalModelHostState> {
    const [modelOk, runtimeOk, online] = await Promise.all([
      modelReady(),
      runtimeReady(),
      health(),
    ]);
    return { ...state, modelReady: modelOk, runtimeReady: runtimeOk, online };
  }

  async function ensureRuntime(onProgress?: (pct: number) => void): Promise<string> {
    const existing = await findServerBinary(runtime);
    if (existing) return existing;
    setState("downloading-runtime", "Downloading CUDA llama-server…", 0);
    await mkdir(runtime, { recursive: true });
    const tag = llamaReleaseTag();
    const serverZip = path.join(runtime, `llama-${tag}-win-cuda.zip`);
    const cudartZip = path.join(runtime, `cudart-${tag}.zip`);
    await downloadFile(runtimeZipUrl(tag), serverZip, (received, total) => {
      if (total) onProgress?.(Math.min(45, Math.round((received / total) * 45)));
    });
    setState("downloading-runtime", "Downloading CUDA runtime…", 50);
    await downloadFile(cudartZipUrl(tag), cudartZip, (received, total) => {
      if (total) onProgress?.(50 + Math.min(40, Math.round((received / total) * 40)));
    });
    setState("installing-runtime", "Unpacking…", 92);
    await expandZip(serverZip, runtime);
    await expandZip(cudartZip, runtime);
    await rm(serverZip, { force: true });
    await rm(cudartZip, { force: true });
    const binary = await findServerBinary(runtime);
    if (!binary) throw new Error("llama-server.exe missing after install");
    return binary;
  }

  async function ensureModel(
    entry: LocalModelCatalogEntry,
    onProgress?: (pct: number) => void,
  ): Promise<void> {
    const dest = path.join(models, entry.filename);
    if (!(await exists(dest))) {
      setState("installing-model", "Looking for the model on this PC…", 0);
      await mkdir(models, { recursive: true });
      let copied = false;
      for (const source of entry.importPaths) {
        if (!(await exists(source))) continue;
        setState("installing-model", "Copying model from WSL…", 10);
        await copyFile(source, dest);
        onProgress?.(100);
        copied = true;
        break;
      }
      if (!copied) {
        setState("downloading-model", `Downloading ${entry.label}…`, 0);
        await downloadFile(entry.downloadUrl, dest, (received, total) => {
          if (total) onProgress?.(Math.round((received / total) * 100));
        });
      }
    }
    if (entry.mmprojFilename && entry.mmprojDownloadUrl) {
      const mmproj = path.join(models, entry.mmprojFilename);
      if (!(await exists(mmproj))) {
        // Best-effort; vision is optional if the URL 404s.
        await downloadFile(entry.mmprojDownloadUrl, mmproj).catch(() => undefined);
      }
    }
  }

  async function start(): Promise<DesktopLocalModelHostState> {
    if (!isWindowsNativeHostSupported()) {
      setState("unsupported", "Windows x64 CUDA host only");
      return refreshFacts(snapshot());
    }
    if (child && !child.killed) {
      setState("running", null, null);
      return refreshFacts(snapshot());
    }
    if (await health()) {
      setState("running", "Already listening", null);
      return refreshFacts(snapshot());
    }
    try {
      const binary = await ensureRuntime((pct) => setState(phase, message, pct));
      for (const entry of LOCAL_MODEL_CATALOG) {
        await ensureModel(entry, (pct) => setState(phase, message, pct));
      }
      setState("starting", "Starting llama-server…", null);
      const ready = new Set<string>();
      for (const entry of LOCAL_MODEL_CATALOG) {
        if (entry.mmprojFilename && (await exists(path.join(models, entry.mmprojFilename)))) {
          ready.add(entry.mmprojFilename);
        }
      }
      const presetPath = path.join(root, "models.ini");
      await writeFile(
        presetPath,
        localModelRouterPreset(models, (filename) => ready.has(filename)),
      );
      const args = [
        "--models-preset",
        presetPath,
        "--models-max",
        "1",
        "--host",
        serverHost(),
        "--port",
        String(port),
        "--no-webui",
        "--metrics",
      ];
      child = spawn(binary, args, {
        cwd: path.dirname(binary),
        windowsHide: true,
        env: { ...process.env },
      });
      const logPath = path.join(root, "llama-server.log");
      const log = createWriteStream(logPath, { flags: "a" });
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      child.on("exit", () => {
        child = null;
        if (phase === "running" || phase === "starting") setState("idle", "Stopped");
      });
      for (let i = 0; i < 90; i += 1) {
        if (await health()) {
          setState("running", null, null);
          return refreshFacts(snapshot());
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      throw new Error("llama-server did not become healthy");
    } catch (error) {
      setState("failed", error instanceof Error ? error.message : "Start failed", null);
      return refreshFacts(snapshot());
    }
  }

  async function stop(): Promise<DesktopLocalModelHostState> {
    if (child) {
      child.kill();
      child = null;
    }
    setState("idle", null, null);
    return refreshFacts(snapshot());
  }

  async function state(): Promise<DesktopLocalModelHostState> {
    if (!isWindowsNativeHostSupported()) {
      return {
        ...snapshot(),
        supported: false,
        phase: "unsupported",
        message: "Windows x64 CUDA host only",
      };
    }
    const next = await refreshFacts(snapshot());
    if (next.online && phase !== "running") {
      phase = "running";
      message = null;
      return { ...next, phase: "running", message: null };
    }
    return next;
  }

  return {
    state,
    start,
    stop,
    onChange(listener: (state: DesktopLocalModelHostState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Stable id for tests / diagnostics. */
    fingerprint: createHash("sha256").update(root).digest("hex").slice(0, 12),
    root,
  };
}

export type LocalModelHost = ReturnType<typeof createLocalModelHost>;
