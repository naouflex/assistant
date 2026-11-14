import { describe, expect, it } from "vitest";
import { ProcessOutputDecoder } from "./process-output-text.js";

describe("process output text", () => {
  it("reads a UTF-16 wsl listing as the distro names", () => {
    const decoder = new ProcessOutputDecoder();
    const bytes = Buffer.from("\ufeff  NAME    STATE\n* Ubuntu-24.04 Running\n", "utf16le");
    expect(
      decoder.push(bytes.subarray(0, 5)) + decoder.push(bytes.subarray(5)) + decoder.end(),
    ).toBe("  NAME    STATE\n* Ubuntu-24.04 Running\n");
  });

  it("keeps split UTF-8 characters intact", () => {
    const decoder = new ProcessOutputDecoder();
    const bytes = Buffer.from("é😀");
    expect(
      decoder.push(bytes.subarray(0, 1)) + decoder.push(bytes.subarray(1)) + decoder.end(),
    ).toBe("é😀");
  });
});
