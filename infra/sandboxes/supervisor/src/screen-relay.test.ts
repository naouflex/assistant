import { describe, expect, it } from "vitest";
import { assignScreenSlot, screenRelayConfig } from "./screen-relay.js";

describe("screen relay", () => {
  it("stays off unless a public host is set", () => {
    expect(screenRelayConfig({})).toBeUndefined();
    expect(screenRelayConfig({ SANDBOX_SCREEN_PUBLIC_HOST: "  " })).toBeUndefined();
  });

  it("publishes a private port range the screen proxy is allowed to dial", () => {
    expect(
      screenRelayConfig({
        SANDBOX_SCREEN_PUBLIC_HOST: "172.17.0.1",
        SANDBOX_SCREEN_PUBLIC_PORT: "16080",
        SANDBOX_SCREEN_PUBLIC_SLOTS: "8",
      }),
    ).toEqual({ host: "172.17.0.1", port: 16080, slots: 8 });
  });

  it("rejects a port the screen proxy would refuse", () => {
    expect(() => screenRelayConfig({ SANDBOX_SCREEN_PUBLIC_HOST: "172.17.0.1", SANDBOX_SCREEN_PUBLIC_PORT: "80" })).toThrow(
      /1024/,
    );
  });

  it("keeps one port per computer and refuses a ninth", () => {
    const slots: Array<string | undefined> = [undefined, undefined];
    expect(assignScreenSlot(slots, "computer-a")).toBe(0);
    expect(assignScreenSlot(slots, "computer-a")).toBe(0);
    expect(assignScreenSlot(slots, "computer-b")).toBe(1);
    expect(() => assignScreenSlot(slots, "computer-c")).toThrow(/no screen relay port/);
  });
});
