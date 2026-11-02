import { describe, expect, it } from "vitest";
import { ATTACH_AFTER_WRITE_PROMPT } from "./attach-after-write.js";

describe("attach after write prompt", () => {
  it("names attach_file and forbids replying first", () => {
    expect(ATTACH_AFTER_WRITE_PROMPT).toContain("attach_file");
    expect(ATTACH_AFTER_WRITE_PROMPT).toContain("before any reply");
  });
});
