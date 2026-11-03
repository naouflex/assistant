import { describe, expect, it } from "vitest";
import { compactToolResultForModel, shellResultSucceeded } from "./tool-result-format.js";

describe("compactToolResultForModel", () => {
  it("keeps a reported shell success and its fields", () => {
    expect(
      compactToolResultForModel(
        { exitCode: 0, stdout: "ok", stderr: "", cwd: "/tmp" },
        "shell",
      ),
    ).toEqual({ ok: true, exitCode: 0, stdout: "ok", stderr: "", cwd: "/tmp" });
  });

  it("does not treat a timed out or killed shell command as success", () => {
    expect(shellResultSucceeded({ timedOut: true })).toBe(false);
    expect(shellResultSucceeded({ killed: true, exitCode: 0 })).toBe(false);
    expect(shellResultSucceeded({ signal: "SIGKILL", exitCode: 0 })).toBe(false);
    expect(shellResultSucceeded({})).toBe(false);
    expect(compactToolResultForModel({ timedOut: true, stdout: "partial" }, "shell")).toMatchObject({
      ok: false,
      timedOut: true,
      stdout: "partial",
    });
    expect(
      compactToolResultForModel({ killed: true, stdout: "partial" }, "user_computer_shell"),
    ).toMatchObject({ ok: false, killed: true });
    expect(compactToolResultForModel({ signal: "SIGTERM" }, "phone_shell")).toMatchObject({
      ok: false,
      signal: "SIGTERM",
    });
  });

  it("keeps error details instead of collapsing them to a string", () => {
    expect(
      compactToolResultForModel(
        { error: "nope", code: "ENOENT", path: "/missing", untrusted: true, note: "x".repeat(50) },
        "read_file",
      ),
    ).toMatchObject({
      ok: false,
      error: "nope",
      code: "ENOENT",
      path: "/missing",
      untrusted: true,
    });
  });

  it("shortens large text and keeps cursors, offsets, and the untrusted flag", () => {
    const content = "a".repeat(9_000);
    expect(
      compactToolResultForModel(
        { content, path: "notes.md", offset: 120, nextOffset: 8120, untrusted: true, revision: 3 },
        "read_file",
      ),
    ).toMatchObject({
      ok: true,
      path: "notes.md",
      offset: 120,
      nextOffset: 8120,
      untrusted: true,
      revision: 3,
    });
    const read = compactToolResultForModel(
      { content, path: "notes.md", offset: 120, untrusted: true },
      "read_memory",
    ) as { content: string };
    expect(read.content.endsWith("…")).toBe(true);
    expect(read.content.length).toBeLessThanOrEqual(8_000);

    expect(
      compactToolResultForModel(
        { url: "https://example.test", title: "Example", content, nextCursor: "page-2", untrusted: true },
        "web_fetch",
      ),
    ).toMatchObject({
      ok: true,
      url: "https://example.test",
      title: "Example",
      nextCursor: "page-2",
      untrusted: true,
    });
  });

  it.each([
    "read_file",
    "write_file",
    "list_files",
    "web_search",
    "web_fetch",
    "ask_user",
    "message_user",
    "remember",
    "search_memory",
    "schedule_create",
    "scratchpad_add",
    "attach_file",
  ])("keeps every field for %s and only shortens large text", (name) => {
    const body = "x".repeat(9_000);
    const shaped = compactToolResultForModel(
      { ok: true, body, cursor: "next", offset: 4, untrusted: true, path: "notes.md" },
      name,
    ) as { body: string; cursor: string; offset: number; untrusted: boolean; path: string };
    expect(shaped.cursor).toBe("next");
    expect(shaped.offset).toBe(4);
    expect(shaped.untrusted).toBe(true);
    expect(shaped.path).toBe("notes.md");
    expect(shaped.body.endsWith("…")).toBe(true);
    expect(shaped.body.length).toBeLessThan(body.length);
  });

  it("treats a plain-text result as success", () => {
    expect(compactToolResultForModel("saved notes.md", "write_file")).toEqual({
      text: "saved notes.md",
      ok: true,
    });
  });

  it("does not invent success when a tool returns nothing", () => {
    expect(compactToolResultForModel(null, "shell")).toEqual({
      ok: false,
      error: "The tool did not report a result.",
    });
  });
});
