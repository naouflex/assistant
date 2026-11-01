// Signs local release builds with your own keystore instead of the template's debug key.
// Set ATLAS_ANDROID_KEYSTORE (path) and ATLAS_ANDROID_KEYSTORE_PASSWORD when running Gradle;
// ATLAS_ANDROID_KEY_ALIAS defaults to "atlas" and ATLAS_ANDROID_KEY_PASSWORD to the store
// password. Without ATLAS_ANDROID_KEYSTORE the release build keeps the debug key, and EAS
// builds keep injecting their own credentials.
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_SIGNING = `
        release {
            if (System.getenv("ATLAS_ANDROID_KEYSTORE")) {
                storeFile file(System.getenv("ATLAS_ANDROID_KEYSTORE"))
                storePassword System.getenv("ATLAS_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ATLAS_ANDROID_KEY_ALIAS") ?: "atlas"
                keyPassword System.getenv("ATLAS_ANDROID_KEY_PASSWORD") ?: System.getenv("ATLAS_ANDROID_KEYSTORE_PASSWORD")
            }
        }`;
const RELEASE_USE =
  'signingConfig System.getenv("ATLAS_ANDROID_KEYSTORE") ? signingConfigs.release : signingConfigs.debug';

function applyReleaseSigning(gradle) {
  if (gradle.includes("ATLAS_ANDROID_KEYSTORE")) return gradle;
  const configs = gradle.indexOf("signingConfigs {");
  const release = gradle.indexOf("release {", gradle.indexOf("buildTypes {"));
  const use = gradle.indexOf("signingConfig signingConfigs.debug", release);
  if (configs < 0 || release < 0 || use < 0)
    throw new Error("with-release-signing: unexpected android/app/build.gradle layout");
  const withUse = `${gradle.slice(0, use)}${RELEASE_USE}${gradle.slice(use + "signingConfig signingConfigs.debug".length)}`;
  const insertAt = configs + "signingConfigs {".length;
  return `${withUse.slice(0, insertAt)}${RELEASE_SIGNING}${withUse.slice(insertAt)}`;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.applyReleaseSigning = applyReleaseSigning;
