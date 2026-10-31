import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_VERSION,
  AccountExportManifestSchema,
  LEGACY_ACCOUNT_EXPORT_FORMAT,
} from "./account-export.js";

const manifest = (format: string) => ({
  format,
  version: ACCOUNT_EXPORT_VERSION,
  exportedAt: "2026-10-31T12:00:00.000Z",
  user: { name: "Ada", email: "ada@example.com", timezone: null },
  spaces: [],
});

describe("account export format", () => {
  it("reads Atlas exports and exports made before the rename", () => {
    expect(AccountExportManifestSchema.parse(manifest(ACCOUNT_EXPORT_FORMAT)).format).toBe(
      ACCOUNT_EXPORT_FORMAT,
    );
    expect(LEGACY_ACCOUNT_EXPORT_FORMAT).toBe("rakazo-account-export");
    expect(
      AccountExportManifestSchema.safeParse(manifest(LEGACY_ACCOUNT_EXPORT_FORMAT)).success,
    ).toBe(true);
    expect(AccountExportManifestSchema.safeParse(manifest("other-export")).success).toBe(false);
  });
});
