import { describe, expect, it } from "vitest";
import { deviceConfig, parseDeviceToken } from "./config.js";

describe("deviceConfig", () => {
  it("keeps the server origin and defaults paths under the user's home", () => {
    expect(
      deviceConfig({ ATLAS_SERVER_URL: "https://atlas.example.test/app", HOME: "/home/pi" }),
    ).toEqual({
      serverUrl: "https://atlas.example.test",
      tokenFile: "/home/pi/.config/atlas-device/token",
      root: "/home/pi/.local/share/atlas-device/computers",
    });
  });

  it("refuses a missing or plain-http remote server", () => {
    expect(() => deviceConfig({})).toThrow(/ATLAS_SERVER_URL/);
    expect(() => deviceConfig({ ATLAS_SERVER_URL: "http://atlas.example.test" })).toThrow(/https/);
    expect(deviceConfig({ ATLAS_SERVER_URL: "http://localhost:3000", HOME: "/h" }).serverUrl).toBe(
      "http://localhost:3000",
    );
  });
});

describe("parseDeviceToken", () => {
  it("accepts one token and rejects anything else", () => {
    expect(parseDeviceToken("fake-token\n")).toBe("fake-token");
    expect(() => parseDeviceToken("")).toThrow();
    expect(() => parseDeviceToken("two tokens")).toThrow();
  });
});
