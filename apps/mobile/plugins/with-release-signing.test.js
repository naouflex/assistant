import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyReleaseSigning } from "./with-release-signing.js";

const require = createRequire(import.meta.url);
const expoTemplateTgz = join(dirname(require.resolve("expo/package.json")), "template.tgz");
// Read the pinned Expo template so a template change fails here instead of at prebuild.
const TEMPLATE = execFileSync(
  "tar",
  ["-xOf", expoTemplateTgz, "package/android/app/build.gradle"],
  {
    encoding: "utf8",
  },
);

describe("applyReleaseSigning", () => {
  it("adds an env-driven release key and uses it only for release builds", () => {
    const result = applyReleaseSigning(TEMPLATE);
    expect(result).toContain('storeFile file(System.getenv("ATLAS_ANDROID_KEYSTORE"))');
    expect(result).toContain(
      'signingConfig System.getenv("ATLAS_ANDROID_KEYSTORE") ? signingConfigs.release : signingConfigs.debug',
    );
    // Debug builds still use the debug key.
    expect(result.match(/signingConfig signingConfigs\.debug\n/g)).toHaveLength(1);
    expect(result).toContain("storeFile file('debug.keystore')");
  });

  it("is idempotent and refuses an unknown layout", () => {
    const once = applyReleaseSigning(TEMPLATE);
    expect(applyReleaseSigning(once)).toBe(once);
    expect(() => applyReleaseSigning("android {}")).toThrow(/unexpected/);
  });
});
