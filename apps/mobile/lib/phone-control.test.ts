import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: vi.fn() }));
vi.mock("./i18n", () => ({ t: (id: string) => id }));
vi.mock("./api", () => ({ authHeaders: vi.fn(), currentApiBase: vi.fn() }));
vi.mock("./server-headers", () => ({ fetchServer: vi.fn(), serverHeaders: vi.fn() }));

const { hasPhoneControl, needsPairing, parsePairResponse, turnOnPhoneControl } = await import(
  "./phone-control"
);

const state = {
  enabled: false,
  connected: false,
  paired: true,
  endpoint: "https://atlas.example",
  deviceId: "d1",
  accessibility: false,
  screenshots: true,
  idleMinutes: 15,
  termuxInstalled: false,
  termuxAllowed: false,
  deviceName: "Pixel",
};

describe("phone control", () => {
  it("is Android only", async () => {
    expect(hasPhoneControl()).toBe(false);
    await expect(turnOnPhoneControl()).rejects.toThrow("Android");
  });

  it("reads the pairing response", () => {
    expect(parsePairResponse({ deviceId: "d1", token: "t1", extra: 1 })).toEqual({
      deviceId: "d1",
      token: "t1",
    });
    expect(() => parsePairResponse({ deviceId: "d1" })).toThrow();
    expect(() => parsePairResponse(null)).toThrow();
  });

  it("pairs again for another server", () => {
    expect(needsPairing(state, "https://atlas.example/")).toBe(false);
    expect(needsPairing(state, "https://other.example")).toBe(true);
    expect(needsPairing({ ...state, paired: false }, "https://atlas.example")).toBe(true);
  });
});
