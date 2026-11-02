import net from "node:net";
import { screenUrlFor } from "./computer-spec.js";

const DEFAULT_PORT = 16080;
const DEFAULT_SLOTS = 8;

export interface ScreenRelayConfig {
  host: string;
  port: number;
  slots: number;
}

/** A public host:port the browser's screen proxy can open. Unset keeps the in-network address. */
export function screenRelayConfig(env: NodeJS.ProcessEnv = process.env): ScreenRelayConfig | undefined {
  const host = env.SANDBOX_SCREEN_PUBLIC_HOST?.trim() ?? "";
  if (!host) return undefined;
  const port = Number(env.SANDBOX_SCREEN_PUBLIC_PORT ?? DEFAULT_PORT);
  const slots = Number(env.SANDBOX_SCREEN_PUBLIC_SLOTS ?? DEFAULT_SLOTS);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("SANDBOX_SCREEN_PUBLIC_PORT must be a TCP port from 1024 to 65535");
  }
  if (!Number.isInteger(slots) || slots < 1 || port + slots - 1 > 65535) {
    throw new Error("SANDBOX_SCREEN_PUBLIC_SLOTS must leave every relay port in range");
  }
  return { host, port, slots };
}

/** Reuse a computer's relay port. A new computer takes the first free slot. */
export function assignScreenSlot(slots: Array<string | undefined>, containerId: string): number {
  const existing = slots.indexOf(containerId);
  if (existing >= 0) return existing;
  const free = slots.findIndex((slot) => slot === undefined);
  if (free < 0) throw new Error("no screen relay port is free");
  slots[free] = containerId;
  return free;
}

interface RelayTarget {
  containerId: string;
  host: string;
  port: number;
}

/**
 * Forwards each public port to that computer's screen. The screen proxy on another machine
 * cannot join this Docker network, so it dials the forwarded port instead of the bridge address.
 */
export class ScreenRelay {
  private readonly owners: Array<string | undefined>;
  private readonly targets: Array<RelayTarget | undefined>;
  private readonly servers: net.Server[] = [];
  private started = false;

  constructor(private readonly config: ScreenRelayConfig) {
    this.owners = Array.from({ length: config.slots });
    this.targets = Array.from({ length: config.slots });
  }

  start(): Promise<void> {
    if (this.started) return Promise.resolve();
    this.started = true;
    return Promise.all(
      this.owners.map((_, index) => this.listen(this.config.port + index)),
    ).then(() => undefined);
  }

  advertise(containerId: string, host: string, port: number): string {
    const index = assignScreenSlot(this.owners, containerId);
    this.targets[index] = { containerId, host, port };
    return screenUrlFor(String(this.config.port + index), this.config.host);
  }

  private listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((client) => this.forward(port, client));
      const fail = (error: Error) => {
        server.close();
        reject(error);
      };
      server.once("error", fail);
      server.listen(port, "0.0.0.0", () => {
        server.off("error", fail);
        server.on("error", () => undefined);
        this.servers.push(server);
        resolve();
      });
    });
  }

  private forward(port: number, client: net.Socket) {
    const target = this.targets[port - this.config.port];
    if (!target) {
      client.destroy();
      return;
    }
    const upstream = net.connect({ host: target.host, port: target.port });
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
    client.pipe(upstream);
    upstream.pipe(client);
  }

  close(): Promise<void> {
    return Promise.all(
      this.servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    ).then(() => undefined);
  }
}

export function createScreenRelay(env: NodeJS.ProcessEnv = process.env): ScreenRelay | undefined {
  const config = screenRelayConfig(env);
  return config ? new ScreenRelay(config) : undefined;
}
