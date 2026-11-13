import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UI_LOCALES } from "./ui-locale";

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nativeRoot = resolve(mobileRoot, "modules/atlas-notifications/android/src/main");

function source(path: string) {
  return readFileSync(resolve(nativeRoot, path), "utf8");
}

describe("iOS call background audio", () => {
  it("keeps a voice call's audio session alive after the app leaves the screen", () => {
    const config = readFileSync(resolve(mobileRoot, "app.json"), "utf8");
    expect(config).toContain('"UIBackgroundModes": ["audio"]');
  });
});

describe("Android call foreground service", () => {
  it("declares a microphone foreground service and wake lock", () => {
    const manifest = source("AndroidManifest.xml");
    expect(manifest).toContain("android.permission.FOREGROUND_SERVICE_MICROPHONE");
    expect(manifest).toContain("android.permission.WAKE_LOCK");
    expect(manifest).toContain('android:name=".AtlasCallService"');
    expect(manifest).toContain('android:foregroundServiceType="microphone"');
  });

  it("starts immediately as a foreground service and holds a partial wake lock", () => {
    const service = source("java/com/naouflex/atlas/notifications/AtlasCallService.kt");
    expect(service).toContain("startForeground");
    expect(service).toContain("FOREGROUND_SERVICE_TYPE_MICROPHONE");
    expect(service).toContain("PowerManager.PARTIAL_WAKE_LOCK");
    expect(service).toContain("context.startForegroundService(intent)");
    expect(service).toContain("context.stopService");
    expect(service).toContain("Manifest.permission.RECORD_AUDIO");
    expect(service).toContain("try {");
    expect(service).toMatch(/catch \(_: Exception\)/);
  });

  it("provides call strings in every shipped mobile locale", () => {
    const directories = {
      en: "values",
      "zh-CN": "values-zh-rCN",
      "zh-TW": "values-zh-rTW",
      ru: "values-ru",
      de: "values-de",
      nl: "values-nl",
      ja: "values-ja",
      es: "values-es",
    } as const satisfies Record<(typeof UI_LOCALES)[number], string>;
    const keys = ["atlas_call_channel", "atlas_call_title", "atlas_call_text"];
    for (const locale of UI_LOCALES) {
      const xml = source(`res/${directories[locale]}/call_strings.xml`);
      for (const key of keys) expect(xml).toContain(`name="${key}"`);
    }
  });

  // call-card-keep-awake.test.tsx covers the call card starting the service instead of keep-awake.
  it("is exposed to the JS bridge", () => {
    const module = source("java/com/naouflex/atlas/notifications/AtlasNotificationsModule.kt");
    expect(module).toContain('AsyncFunction("startCall")');
    expect(module).toContain('AsyncFunction("stopCall")');
  });
});

describe("Android read-aloud playback service", () => {
  it("declares a media playback foreground service", () => {
    const manifest = source("AndroidManifest.xml");
    expect(manifest).toContain("android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK");
    expect(manifest).toContain('android:name=".AtlasPlaybackService"');
    expect(manifest).toContain('android:foregroundServiceType="mediaPlayback"');
  });

  it("runs in the foreground with a Stop action and a media session", () => {
    const service = source("java/com/naouflex/atlas/notifications/AtlasPlaybackService.kt");
    expect(service).toContain("FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK");
    expect(service).toContain("context.startForegroundService(intent)");
    expect(service).toContain("context.stopService");
    expect(service).toContain("ACTION_STOP");
    expect(service).toContain("MediaSession");
    expect(service).toMatch(/catch \(_: Exception\)/);
  });

  it("is exposed to the JS bridge with a stop event", () => {
    const module = source("java/com/naouflex/atlas/notifications/AtlasNotificationsModule.kt");
    expect(module).toContain('AsyncFunction("startPlayback")');
    expect(module).toContain('AsyncFunction("stopPlayback")');
    expect(module).toContain('Events("onPlaybackStop")');
  });

  it("provides playback strings in every shipped mobile locale", () => {
    const directories = {
      en: "values",
      "zh-CN": "values-zh-rCN",
      "zh-TW": "values-zh-rTW",
      ru: "values-ru",
      de: "values-de",
      nl: "values-nl",
      ja: "values-ja",
      es: "values-es",
    } as const satisfies Record<(typeof UI_LOCALES)[number], string>;
    const keys = [
      "atlas_playback_channel",
      "atlas_playback_title",
      "atlas_playback_text",
      "atlas_playback_stop",
    ];
    for (const locale of UI_LOCALES) {
      const xml = source(`res/${directories[locale]}/playback_strings.xml`);
      for (const key of keys) expect(xml).toContain(`name="${key}"`);
    }
  });

  it("lets replies keep playing once the app leaves the screen", () => {
    const config = readFileSync(resolve(mobileRoot, "app.json"), "utf8");
    expect(config).toContain('"enableBackgroundPlayback": true');
  });
});
