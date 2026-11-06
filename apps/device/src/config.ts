import os from "node:os";
import path from "node:path";

export interface DeviceConfig {
  serverUrl: string;
  tokenFile: string;
  root: string;
}

/** The token stays in a file only its owner can read, never in the environment or argv. */
export function deviceConfig(env: Record<string, string | undefined>): DeviceConfig {
  const raw = env.ATLAS_SERVER_URL?.trim();
  if (!raw)
    throw new Error(
      "Set ATLAS_SERVER_URL to your Atlas server, for example https://atlas.example.com",
    );
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    throw new Error("ATLAS_SERVER_URL must use https");
  const home = env.HOME?.trim() || os.homedir();
  return {
    serverUrl: url.origin,
    tokenFile: env.ATLAS_DEVICE_TOKEN_FILE?.trim() || path.join(home, ".config/atlas-device/token"),
    root: env.ATLAS_DEVICE_ROOT?.trim() || path.join(home, ".local/share/atlas-device/computers"),
  };
}

export function parseDeviceToken(contents: string): string {
  const token = contents.trim();
  if (!token || /\s/.test(token)) throw new Error("The token file must hold one device token");
  return token;
}
