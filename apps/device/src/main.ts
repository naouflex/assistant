import { readFile, stat } from "node:fs/promises";
import { startUserDeviceClient } from "@atlas/adapters/user-device-client";
import { deviceConfig, parseDeviceToken } from "./config.js";

/** systemd leaves a revoked device stopped instead of restarting it. */
const REVOKED_EXIT_CODE = 78;

const config = deviceConfig(process.env);
const info = await stat(config.tokenFile);
if (info.mode & 0o077) throw new Error(`${config.tokenFile} must be readable only by its owner`);
const token = parseDeviceToken(await readFile(config.tokenFile, "utf8"));

const client = startUserDeviceClient({
  serverUrl: config.serverUrl,
  token,
  root: config.root,
  // Installing this service is the owner's consent; there is nobody here to ask.
  authorize: async () => true,
  onRevoked: () => {
    console.error("This computer was removed from Atlas. Pair it again to reconnect.");
    process.exit(REVOKED_EXIT_CODE);
  },
});

console.log(`Atlas computer connecting to ${config.serverUrl}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    client.close();
    process.exit(0);
  });
}
