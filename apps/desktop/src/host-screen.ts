import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
import { createCuaHostScreen, cuaDriverConnector } from "@atlas/adapters/cua-host-screen";
import type { HostScreen } from "@atlas/adapters/host-screen";
import { HostScreenError, hostScreenSupported } from "@atlas/adapters/host-screen";

export const SCREEN_LOCKED_MESSAGE =
  "The user's screen is locked, so their apps can't be seen or used. Ask them to unlock it, then try again.";
export const SCREEN_DRIVER_DOWNLOAD_MESSAGE =
  "Screen control couldn't be set up on this computer. Ask the user to check their internet connection, then try again.";
export const SCREEN_DRIVER_START_MESSAGE = "Screen control couldn't start on this computer.";
export const SCREEN_PERMISSION_MESSAGE =
  "Atlas needs Accessibility and Screen Recording access on this Mac. Ask the user to allow Atlas in System Settings > Privacy & Security, quit and reopen Atlas, then try again.";

/** The parts of Electron's macOS permission API this uses. */
export interface ScreenPermissionApi {
  isTrustedAccessibilityClient(prompt: boolean): boolean;
  getMediaAccessStatus(mediaType: "screen"): string;
  /** Lists windows, which makes macOS ask for Screen Recording the first time. */
  requestScreenCapture(): Promise<unknown>;
}

/**
 * Asks macOS for both permissions, attributed to this app, before the driver starts. Each
 * prompt appears only while its permission is missing, so it never repeats once granted.
 */
export async function ensureScreenPermissions(api: ScreenPermissionApi) {
  const accessibility = api.isTrustedAccessibilityClient(true);
  if (api.getMediaAccessStatus("screen") !== "granted")
    await api.requestScreenCapture().catch(() => undefined);
  if (!accessibility || api.getMediaAccessStatus("screen") !== "granted")
    throw new HostScreenError(SCREEN_PERMISSION_MESSAGE);
}

/** One checksummed driver file. Changing a pin is a reviewed edit. */
export interface ScreenDriverRelease {
  url: string;
  sha256: string;
  driverSha256: string;
  /** File name inside the archive. A single path segment, never a directory. */
  executable: string;
}

const DRIVER_VERSION = "cua-driver-rs-v0.38.0";
const DRIVER_BASE = `https://github.com/trycua/cua/releases/download/${DRIVER_VERSION}`;

/** The macOS driver this app already ran. Kept as the default pin for that platform. */
export const SCREEN_DRIVER_RELEASE: ScreenDriverRelease = {
  url: `${DRIVER_BASE}/cua-driver-rs-0.38.0-darwin-universal-binary.tar.gz`,
  sha256: "2bb8dc4a7e69185ffd04c4a9c0eab590bd2c54b72c2c1be13ab675be4f487732",
  driverSha256: "92067848d0eeb9de76929fbd06a137af801b0ff6caedbb3109bd7a6cc84a1f9f",
  executable: "cua-driver",
};

const SCREEN_DRIVER_RELEASES: Partial<
  Record<NodeJS.Platform, Partial<Record<string, ScreenDriverRelease>>>
> = {
  darwin: { x64: SCREEN_DRIVER_RELEASE, arm64: SCREEN_DRIVER_RELEASE },
  win32: {
    x64: {
      url: `${DRIVER_BASE}/cua-driver-rs-0.38.0-windows-x86_64-binary.zip`,
      sha256: "5edaa74d0afa1b55a9668dbc4f32736507bd2bd4d75b18ca1dc8881bb12402b5",
      driverSha256: "ffa58d88779ee219304b0c307f4cfa970fe822f830c6ecf9254eda5c29e22bf2",
      executable: "cua-driver.exe",
    },
    arm64: {
      url: `${DRIVER_BASE}/cua-driver-rs-0.38.0-windows-arm64-binary.zip`,
      sha256: "d25c8ebfffb34e4c095ea170baf47b87c35dc0d1116f42e46b39df2bcbff8700",
      driverSha256: "2d6a0822be887a8a51678f57682d7362d484d4049b769ef964f0c2dffda29de1",
      executable: "cua-driver.exe",
    },
  },
  linux: {
    x64: {
      url: `${DRIVER_BASE}/cua-driver-rs-0.38.0-linux-x86_64-binary.tar.gz`,
      sha256: "31ab9709dd91ce73677e49b9f3e75c6f0d3e4d9625c286c9e58262bfbea698dd",
      driverSha256: "bf57b2f3778a0a7daa9388e241f20ce948b32a7a2f4dd102e497f34e54137934",
      executable: "cua-driver",
    },
    arm64: {
      url: `${DRIVER_BASE}/cua-driver-rs-0.38.0-linux-arm64-binary.tar.gz`,
      sha256: "80c9ae66bc7322052dd426c6133c96086b33894bf06c972bca8215384400b33d",
      driverSha256: "26e9eee8165e9ce7b614b5e3d68e5d963231385a82b65236406718b5ce1ff936",
      executable: "cua-driver",
    },
  },
};

/** The pinned driver for this desktop, or nothing when this CPU has no build. */
export function screenDriverRelease(platform: NodeJS.Platform, arch: string) {
  return SCREEN_DRIVER_RELEASES[platform]?.[arch];
}

export function screenDriverReleases(): ScreenDriverRelease[] {
  const seen = new Set<string>();
  const releases: ScreenDriverRelease[] = [];
  for (const byArch of Object.values(SCREEN_DRIVER_RELEASES)) {
    for (const release of Object.values(byArch ?? {})) {
      if (!release || seen.has(release.url)) continue;
      seen.add(release.url);
      releases.push(release);
    }
  }
  return releases;
}

async function fileSha256(file: string) {
  try {
    return createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  } catch {
    return undefined;
  }
}

/**
 * Downloads the pinned driver into `dir` the first time it is needed, so only people who use
 * screen control pay for it, and returns its path. Any other download is refused, and earlier
 * versions are removed. It is checked again before every start and replaced if anything
 * changed it.
 */
export function screenDriverInstaller(options: {
  dir: string;
  fetch: (url: string) => Promise<Response>;
  release?: ScreenDriverRelease;
}): () => Promise<string> {
  const release = options.release ?? SCREEN_DRIVER_RELEASE;
  const command = path.join(options.dir, release.driverSha256, release.executable);
  let pending: Promise<string> | undefined;

  async function install() {
    await mkdir(options.dir, { recursive: true });
    const staging = await mkdtemp(path.join(options.dir, ".download-"));
    try {
      const response = await options.fetch(release.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const archive = Buffer.from(await response.arrayBuffer());
      if (createHash("sha256").update(archive).digest("hex") !== release.sha256)
        throw new Error("checksum mismatch");
      const archivePath = path.join(staging, "driver.archive");
      await writeFile(archivePath, archive);
      if (release.url.endsWith(".zip"))
        await writeFile(
          path.join(staging, release.executable),
          extractZipEntry(archive, release.executable),
        );
      else
        await promisify(execFile)("/usr/bin/tar", [
          "-xzf",
          archivePath,
          "-C",
          staging,
          release.executable,
        ]);
      await rm(archivePath);
      if ((await fileSha256(path.join(staging, release.executable))) !== release.driverSha256)
        throw new Error("checksum mismatch");
      for (const entry of await readdir(options.dir))
        if (entry !== path.basename(staging))
          await rm(path.join(options.dir, entry), { recursive: true, force: true });
      await rename(staging, path.dirname(command));
      return command;
    } catch {
      throw new HostScreenError(SCREEN_DRIVER_DOWNLOAD_MESSAGE);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  async function verified() {
    return (await fileSha256(command)) === release.driverSha256 ? command : install();
  }

  return () => {
    pending ??= verified().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

/**
 * One file from a zip whose sizes are in the local header. The archive checksum is already
 * verified, so this only has to pull the pinned executable out.
 */
function extractZipEntry(archive: Buffer, name: string): Buffer {
  if (name.includes("/") || name.includes("\\") || name.includes(".."))
    throw new Error("bad executable");
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const flags = archive.readUInt16LE(offset + 6);
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (flags & 0x8 || dataEnd > archive.length) throw new Error("bad zip");
    const entryName = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    if (entryName === name) {
      const compressed = archive.subarray(dataStart, dataEnd);
      if (method === 0) return Buffer.from(compressed);
      if (method === 8) return inflateRawSync(compressed);
      throw new Error("bad zip");
    }
    offset = dataEnd;
  }
  throw new Error("missing executable");
}

/** Screen control for a desktop that has a pinned driver, or undefined on other platforms. */
export function createDesktopHostScreen(options: {
  platform: NodeJS.Platform;
  /** Resolves to the driver executable, fetching it first if needed. */
  driver: () => Promise<string>;
  home: string;
  permissions: ScreenPermissionApi;
  /** A locked screen hides every window, so apps opened behind it show none. */
  locked: () => boolean;
}): HostScreen | undefined {
  if (!hostScreenSupported(options.platform)) return undefined;
  const screen = createCuaHostScreen({
    connect: async () => {
      try {
        return await cuaDriverConnector({
          command: await options.driver(),
          home: options.home,
        })();
      } catch (error) {
        if (error instanceof HostScreenError) throw error;
        throw new HostScreenError(SCREEN_DRIVER_START_MESSAGE);
      }
    },
    permissions: () =>
      options.platform === "darwin"
        ? ensureScreenPermissions(options.permissions)
        : Promise.resolve(),
    selfPid: process.pid,
  });
  const unlocked = () => {
    if (options.locked()) throw new HostScreenError(SCREEN_LOCKED_MESSAGE);
  };
  return {
    observe: async (scope, app, observeOptions) => {
      unlocked();
      return screen.observe(scope, app, observeOptions);
    },
    act: async (scope, app, actions) => {
      unlocked();
      return screen.act(scope, app, actions);
    },
    close: () => screen.close(),
  };
}
