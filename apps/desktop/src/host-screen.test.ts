import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { HostScreenError, hostScreenSupported } from "@atlas/adapters/host-screen";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenDriverRelease, ScreenPermissionApi } from "./host-screen.js";
import {
  createDesktopHostScreen,
  ensureScreenPermissions,
  SCREEN_DRIVER_DOWNLOAD_MESSAGE,
  SCREEN_DRIVER_START_MESSAGE,
  SCREEN_LOCKED_MESSAGE,
  SCREEN_PERMISSION_MESSAGE,
  screenDriverInstaller,
  screenDriverRelease,
  screenDriverReleases,
} from "./host-screen.js";

const scope = { botId: "bot-1", signal: new AbortController().signal };

function permissions(accessibility: boolean, screen: string[]) {
  const statuses = [...screen];
  return {
    isTrustedAccessibilityClient: vi.fn(() => accessibility),
    getMediaAccessStatus: vi.fn(() => statuses.shift() ?? "denied"),
    requestScreenCapture: vi.fn(async () => []),
  } satisfies ScreenPermissionApi;
}

describe("screen permissions", () => {
  it("passes once both are granted without asking for Screen Recording again", async () => {
    const api = permissions(true, ["granted", "granted"]);
    await ensureScreenPermissions(api);
    expect(api.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
    expect(api.requestScreenCapture).not.toHaveBeenCalled();
  });

  it("asks for Screen Recording while it is missing and refuses until it is granted", async () => {
    const api = permissions(true, ["not-determined", "denied"]);
    await expect(ensureScreenPermissions(api)).rejects.toThrow(SCREEN_PERMISSION_MESSAGE);
    expect(api.requestScreenCapture).toHaveBeenCalledOnce();
  });

  it("refuses without Accessibility", async () => {
    await expect(ensureScreenPermissions(permissions(false, ["granted"]))).rejects.toThrow(
      SCREEN_PERMISSION_MESSAGE,
    );
  });
});

describe("desktop screen", () => {
  const options = {
    driver: async () => "/missing/cua-driver",
    home: "/missing",
    locked: () => false,
  };

  it("exists on the desktops that have a pinned driver", () => {
    const api = permissions(true, []);
    for (const platform of ["darwin", "win32", "linux"] as const) {
      expect(hostScreenSupported(platform)).toBe(true);
      expect(createDesktopHostScreen({ ...options, permissions: api, platform })).toBeDefined();
      expect(screenDriverRelease(platform, "x64")?.url).toMatch(
        /^https:\/\/github\.com\/trycua\/cua\/releases\/download\/cua-driver-rs-v[\d.]+\/cua-driver-rs-[\d.]+-/,
      );
    }
    expect(screenDriverRelease("win32", "ia32")).toBeUndefined();
    expect(
      createDesktopHostScreen({ ...options, permissions: api, platform: "aix" }),
    ).toBeUndefined();
    expect(hostScreenSupported("android")).toBe(false);
  });

  it("says the screen is locked before starting anything", async () => {
    const api = permissions(true, ["granted", "granted"]);
    const driver = vi.fn(options.driver);
    const screen = createDesktopHostScreen({
      ...options,
      driver,
      platform: "darwin",
      permissions: api,
      locked: () => true,
    })!;
    await expect(screen.observe(scope, "TextEdit")).rejects.toThrow(SCREEN_LOCKED_MESSAGE);
    await expect(screen.act(scope, "TextEdit", [{ kind: "wait", ms: 0 }])).rejects.toThrow(
      SCREEN_LOCKED_MESSAGE,
    );
    expect(api.isTrustedAccessibilityClient).not.toHaveBeenCalled();
    expect(driver).not.toHaveBeenCalled();
  });

  it("fetches the driver only once the permissions are granted", async () => {
    const driver = vi.fn(async () => {
      throw new HostScreenError(SCREEN_DRIVER_DOWNLOAD_MESSAGE);
    });
    const denied = createDesktopHostScreen({
      ...options,
      driver,
      platform: "darwin",
      permissions: permissions(false, ["granted"]),
    })!;
    await expect(denied.observe(scope, "TextEdit")).rejects.toThrow(SCREEN_PERMISSION_MESSAGE);
    expect(driver).not.toHaveBeenCalled();
    const granted = createDesktopHostScreen({
      ...options,
      driver,
      platform: "darwin",
      permissions: permissions(true, ["granted", "granted"]),
    })!;
    await expect(granted.observe(scope, "TextEdit")).rejects.toThrow(
      SCREEN_DRIVER_DOWNLOAD_MESSAGE,
    );
  });

  it("starts the driver on Windows without the Mac permission prompts", async () => {
    const api = permissions(false, ["denied"]);
    const driver = vi.fn(async () => {
      throw new Error("spawn ENOENT");
    });
    const screen = createDesktopHostScreen({
      ...options,
      driver,
      platform: "win32",
      permissions: api,
    })!;
    await expect(screen.observe(scope, "Notepad")).rejects.toThrow(SCREEN_DRIVER_START_MESSAGE);
    expect(api.isTrustedAccessibilityClient).not.toHaveBeenCalled();
    expect(api.requestScreenCapture).not.toHaveBeenCalled();
    expect(driver).toHaveBeenCalledOnce();
  });
});

describe("screen driver download", () => {
  let dir: string;
  let archive: Buffer;
  let release: ScreenDriverRelease;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "atlas-screen-driver-"));
    const source = path.join(dir, "source");
    await mkdir(source);
    await writeFile(path.join(source, "cua-driver"), "#!/bin/sh\n", { mode: 0o755 });
    await writeFile(path.join(source, "libcua_driver_sdk.dylib"), "unused");
    execFileSync("tar", [
      "-czf",
      path.join(dir, "driver.tar.gz"),
      "-C",
      source,
      "cua-driver",
      "libcua_driver_sdk.dylib",
    ]);
    archive = await readFile(path.join(dir, "driver.tar.gz"));
    release = {
      url: "https://example.test/driver.tar.gz",
      sha256: createHash("sha256").update(archive).digest("hex"),
      driverSha256: createHash("sha256").update("#!/bin/sh\n").digest("hex"),
      executable: "cua-driver",
    };
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const serve = (body: Buffer) => vi.fn(async () => new Response(new Uint8Array(body)));

  it("downloads the pinned driver once, keeps only it, and reuses it after a restart", async () => {
    const bin = path.join(dir, "bin");
    await mkdir(path.join(bin, "older-version"), { recursive: true });
    const fetch = serve(archive);
    const install = screenDriverInstaller({ dir: bin, fetch, release });
    const [command, again] = await Promise.all([install(), install()]);
    expect(again).toBe(command);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(release.url);
    expect(await readFile(command, "utf8")).toBe("#!/bin/sh\n");
    expect(await readdir(bin)).toEqual([release.driverSha256]);
    expect(await readdir(path.dirname(command))).toEqual(["cua-driver"]);
    const restarted = screenDriverInstaller({ dir: bin, fetch, release });
    await expect(restarted()).resolves.toBe(command);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("replaces a cached driver that something else changed before starting it", async () => {
    const bin = path.join(dir, "bin");
    const fetch = serve(archive);
    const install = screenDriverInstaller({ dir: bin, fetch, release });
    const command = await install();
    await writeFile(command, "#!/bin/sh\necho replaced\n");
    await expect(install()).resolves.toBe(command);
    expect(await readFile(command, "utf8")).toBe("#!/bin/sh\n");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refuses anything but the pinned archive and tries again next time", async () => {
    const bin = path.join(dir, "bin");
    const fetch = serve(Buffer.from("tampered"));
    const install = screenDriverInstaller({ dir: bin, fetch, release });
    await expect(install()).rejects.toThrow(SCREEN_DRIVER_DOWNLOAD_MESSAGE);
    expect(await readdir(bin)).toEqual([]);
    fetch.mockImplementationOnce(async () => new Response("", { status: 503 }));
    await expect(install()).rejects.toThrow(SCREEN_DRIVER_DOWNLOAD_MESSAGE);
    fetch.mockImplementationOnce(async () => new Response(new Uint8Array(archive)));
    await expect(install()).resolves.toBe(path.join(bin, release.driverSha256, "cua-driver"));
  });

  it("extracts the pinned executable from a zip", async () => {
    const body = Buffer.from("MZ-fake-driver");
    const name = "cua-driver.exe";
    const compressed = deflateRawSync(body);
    const nameBytes = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const zip = Buffer.concat([header, nameBytes, compressed]);
    const zipRelease: ScreenDriverRelease = {
      url: "https://example.test/driver.zip",
      sha256: createHash("sha256").update(zip).digest("hex"),
      driverSha256: createHash("sha256").update(body).digest("hex"),
      executable: name,
    };
    const bin = path.join(dir, "zip-bin");
    const install = screenDriverInstaller({ dir: bin, fetch: serve(zip), release: zipRelease });
    const command = await install();
    expect(command).toBe(path.join(bin, zipRelease.driverSha256, name));
    expect(await readFile(command)).toEqual(body);
  });

  it("pins one checksummed release per desktop from the driver's publisher", () => {
    const releases = screenDriverReleases();
    expect(releases.map((release) => release.executable).sort()).toEqual([
      "cua-driver",
      "cua-driver",
      "cua-driver",
      "cua-driver.exe",
      "cua-driver.exe",
    ]);
    for (const release of releases) {
      expect(release.url).toMatch(
        /^https:\/\/github\.com\/trycua\/cua\/releases\/download\/cua-driver-rs-v[\d.]+\/cua-driver-rs-[\d.]+-(darwin-universal-binary\.tar\.gz|linux-(x86_64|arm64)-binary\.tar\.gz|windows-(x86_64|arm64)-binary\.zip)$/,
      );
      expect(release.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(release.driverSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(release.executable === "cua-driver" || release.executable === "cua-driver.exe").toBe(
        true,
      );
    }
  });
});
