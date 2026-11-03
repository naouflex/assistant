import { describe, expect, it } from "vitest";
import { compactToolResultForModel } from "./tool-result-format.js";

describe("compactToolResultForModel", () => {
  it("shapes shell output", () => {
    expect(compactToolResultForModel({ exitCode: 0, stdout: "ok" }, "shell")).toEqual({
      ok: true,
      exitCode: 0,
      stdout: "ok",
    });
  });

  it("surfaces errors first", () => {
    expect(compactToolResultForModel({ error: "nope" }, "read_file")).toEqual({
      ok: false,
      error: "nope",
    });
  });
});
