import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { redirectSystemPath } from "../app/+native-intent";
import {
  closeSettingsSheet,
  isSettingsLink,
  registerSettingsSheet,
  settingsSheetCloser,
} from "./settings-sheet";

vi.mock("./incoming-share", () => ({ receiveIncomingShare: vi.fn() }));

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("settings sheet", () => {
  it("does nothing while no sheet is open", () => {
    expect(() => closeSettingsSheet()).not.toThrow();
  });

  it("closes the open sheet, and stops once it unregisters", () => {
    const close = vi.fn();
    const unregister = registerSettingsSheet(close);
    closeSettingsSheet();
    unregister();
    closeSettingsSheet();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps a newer sheet registered when an older one unregisters late", () => {
    const older = vi.fn();
    const newer = vi.fn();
    const unregisterOlder = registerSettingsSheet(older);
    const unregisterNewer = registerSettingsSheet(newer);
    unregisterOlder();
    closeSettingsSheet();
    unregisterNewer();

    expect(older).not.toHaveBeenCalled();
    expect(newer).toHaveBeenCalledTimes(1);
  });

  it("goes back to the screen under the sheet", () => {
    const sheet = { canGoBack: () => true, goBack: vi.fn(), dispatch: vi.fn() };
    settingsSheetCloser(sheet)();

    expect(sheet.goBack).toHaveBeenCalledTimes(1);
    expect(sheet.dispatch).not.toHaveBeenCalled();
  });

  it("gives way to Home as the app's first screen", () => {
    const sheet = { canGoBack: () => false, goBack: vi.fn(), dispatch: vi.fn() };
    settingsSheetCloser(sheet)();

    expect(sheet.goBack).not.toHaveBeenCalled();
    expect(sheet.dispatch).toHaveBeenCalledWith({ type: "REPLACE", payload: { name: "index" } });
  });
});

describe("settings links", () => {
  it.each([true, false])("opens the share target for cold/warm arrivals (%s)", (initial) => {
    expect(redirectSystemPath({ path: "atlas://expo-sharing", initial })).toBe("/share");
  });
  it("knows every public page in the settings group", () => {
    const pages = readdirSync(resolve(mobileRoot, "app/(settings)"))
      .filter((file) => !["_layout.tsx", "model-picker.tsx", "model-connection.tsx"].includes(file))
      .map((file) => file.replace(/\.tsx$/, ""));

    for (const page of pages) expect(isSettingsLink(`/${page}`), page).toBe(true);
  });

  it("reads the page from any link form", () => {
    expect(isSettingsLink("atlas:///models")).toBe(true);
    // Picker sessions only exist after an in-sheet push, never from a link.
    expect(isSettingsLink("atlas:///model-picker")).toBe(false);
    expect(isSettingsLink("atlas:///model-connection")).toBe(false);
    expect(isSettingsLink("atlas://voice")).toBe(true);
    expect(isSettingsLink("atlas:///account?focus=usage")).toBe(true);
    expect(isSettingsLink("atlas://integrations/")).toBe(true);
    expect(isSettingsLink("/change-password")).toBe(true);
    expect(isSettingsLink("atlas:///thread?botId=bot-1")).toBe(false);
    expect(isSettingsLink("atlas://group-thread?groupId=group-1")).toBe(false);
    expect(isSettingsLink("/new")).toBe(false);
    expect(isSettingsLink("/artifacts")).toBe(false);
    expect(isSettingsLink("atlas:///artifacts")).toBe(false);
    expect(isSettingsLink("atlas://")).toBe(false);
    expect(isSettingsLink("atlas:///accounts")).toBe(false);
  });

  it("closes the sheet before a link to another screen, and keeps settings links in it", () => {
    const close = vi.fn();
    const unregister = registerSettingsSheet(close);

    expect(redirectSystemPath({ path: "atlas:///voice", initial: false })).toBe("atlas:///voice");
    expect(redirectSystemPath({ path: "atlas:///account?focus=usage", initial: false })).toBe(
      "atlas:///account?focus=usage",
    );
    expect(close).not.toHaveBeenCalled();

    expect(redirectSystemPath({ path: "atlas:///thread?botId=bot-1", initial: false })).toBe(
      "atlas:///thread?botId=bot-1",
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(redirectSystemPath({ path: "atlas://expo-sharing", initial: true })).toBe("/share");
    expect(close).toHaveBeenCalledTimes(2);
    expect(redirectSystemPath({ path: "atlas:///artifacts", initial: false })).toBe(
      "atlas:///artifacts",
    );
    expect(close).toHaveBeenCalledTimes(3);
    unregister();
  });
});
