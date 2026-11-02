import { describe, expect, it } from "vitest";
import { MODEL_CANNOT_SEE_MESSAGE } from "./model-vision.js";
import { phoneAction, userDeviceKind } from "./phone-protocol.js";
import type { RunContext } from "./run-context.js";
import { phoneActionFor, phoneScreenResult, phoneShellResult } from "./run-tools-phone.js";

const ctx = (acceptsImages: boolean) =>
  ({ computer: { acceptsImages }, secrets: ["sk-test-secret-value"] }) as unknown as RunContext;
const screen = {
  package: "com.android.settings",
  width: 576,
  height: 1280,
  tree: '[0] TextView "Wi-Fi"',
  image: { mimeType: "image/png", data: "aW1n", width: 576, height: 1280 },
};

describe("phone actions", () => {
  it("maps tool arguments to the action the phone runs", () => {
    expect(phoneActionFor("phone_screenshot", {})).toEqual({ action: { op: "screenshot" } });
    expect(phoneActionFor("phone_ui_tree", { query: " wifi " })).toEqual({
      action: { op: "uiTree", query: "wifi" },
    });
    expect(phoneActionFor("phone_tap", { element: 3, long: true })).toEqual({
      action: { op: "tap", element: 3, long: true },
    });
    expect(phoneActionFor("phone_tap", { x: 10.4, y: 20 })).toEqual({
      action: { op: "tap", x: 10, y: 20 },
    });
    expect(phoneActionFor("phone_swipe", { direction: "up", duration_ms: 300 })).toEqual({
      action: { op: "swipe", direction: "up", durationMs: 300 },
    });
    expect(phoneActionFor("phone_type", { text: "hi", submit: true })).toEqual({
      action: { op: "type", text: "hi", submit: true },
    });
    expect(phoneActionFor("phone_key", { key: "back" })).toEqual({
      action: { op: "key", key: "back" },
    });
    expect(phoneActionFor("phone_open_app", { app: "Chrome" })).toEqual({
      action: { op: "openApp", app: "Chrome" },
    });
    expect(phoneActionFor("phone_shell", { command: "ls", termux: true })).toEqual({
      action: { op: "shell", command: "ls", timeoutMs: expect.any(Number), termux: true },
    });
  });

  it("names what is missing or wrong", () => {
    expect(phoneActionFor("phone_tap", { x: 1 })).toEqual({
      error: "phone_tap needs element, or both x and y.",
    });
    expect(phoneActionFor("phone_swipe", { x1: 1, y1: 2 })).toEqual({
      error: "phone_swipe needs direction, or x1, y1, x2 and y2.",
    });
    expect(phoneActionFor("phone_key", { key: "volume_up" })).toHaveProperty("error");
    expect(phoneActionFor("phone_open_app", { app: "" })).toHaveProperty("error");
    expect(phoneActionFor("phone_shell", { command: "" })).toEqual({
      error: "command must be 1 to 65536 characters.",
    });
    expect(phoneActionFor("phone_swipe", { direction: "up", duration_ms: 10 })).toHaveProperty(
      "error",
    );
  });

  it("parses only known actions", () => {
    expect(phoneAction.safeParse({ op: "install", package: "x" }).success).toBe(false);
    expect(userDeviceKind("android")).toBe("phone");
    expect(userDeviceKind("darwin")).toBe("computer");
  });
});

describe("phone results", () => {
  it("sends the screenshot to a model that can see it and stores only its size", () => {
    const result = phoneScreenResult(ctx(true), screen, "screenshot");
    expect(result.details).toEqual({ package: "com.android.settings", width: 576, height: 1280 });
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining('[0] TextView "Wi-Fi"') },
      { type: "image", data: "aW1n", mimeType: "image/png" },
    ]);
    expect(JSON.stringify(result.details)).not.toContain("aW1n");
  });

  it("leaves the image out for a model that cannot see and says so", () => {
    const result = phoneScreenResult(ctx(false), screen, "screenshot");
    expect(result.content).toEqual([
      { type: "text", text: expect.stringContaining(MODEL_CANNOT_SEE_MESSAGE) },
    ]);
  });

  it("redacts secrets from the screen and the shell", () => {
    const tree = phoneScreenResult(ctx(true), { ...screen, tree: "key sk-test-secret-value" }, "");
    expect(JSON.stringify(tree.content)).not.toContain("sk-test-secret-value");
    const shell = phoneShellResult(ctx(true), {
      exitCode: 0,
      stdout: "sk-test-secret-value\n",
      stderr: "",
      runner: "sh",
    });
    expect(shell.stdout).not.toContain("sk-test-secret-value");
    expect(shell).toMatchObject({ exitCode: 0, runner: "sh" });
  });
});
