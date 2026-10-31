/**
 * Atlas was forked from Rakazo, whose settings used the RAKAZO_ prefix. Existing
 * installs still have those names in `.env`, systemd units and CI secrets, so every
 * entry point copies each legacy name onto its ATLAS_ spelling before anything reads
 * it. The ATLAS_ value always wins when both are set.
 */
export const LEGACY_ENV_BRAND = "RAKAZO";
export const ENV_BRAND = "ATLAS";

/** The ATLAS_ name for a legacy key such as RAKAZO_IMAGE_TAG or SLACK_RAKAZO_BOT_ID. */
export function atlasEnvName(legacyName: string): string | undefined {
  const pattern = new RegExp(`(^|_)${LEGACY_ENV_BRAND}(_|$)`);
  if (!pattern.test(legacyName)) return undefined;
  return legacyName.replace(pattern, `$1${ENV_BRAND}$2`);
}

/**
 * Copies legacy RAKAZO_* values onto unset ATLAS_* names in place and returns the
 * names it filled. Works on `process.env` or on any parsed env file record.
 */
export function applyLegacyEnvAliases(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const filled: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const next = atlasEnvName(key);
    if (!next || env[next] !== undefined) continue;
    env[next] = value;
    filled.push(next);
  }
  return filled;
}
