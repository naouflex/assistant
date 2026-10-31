import { describe, expect, it } from "vitest";
import { asksAboutOwnFiles, mountedFolders, ownFilesNote } from "./mounted-files.js";

const MOUNTS =
  "/home/n/canopy:/mnt/naoufel/canopy:ro,/home/n/casino/docs:/mnt/naoufel/casino/docs:ro,/home/n/casino/subgraph:/mnt/naoufel/casino/subgraph:ro,/srv/x:/mnt/shared";

describe("mountedFolders", () => {
  it("groups repo mounts under their parent and keeps lone mounts as roots", () => {
    expect(mountedFolders(MOUNTS)).toEqual({
      roots: ["/mnt/naoufel", "/mnt/shared"],
      names: ["canopy", "casino"],
    });
  });
  it("ignores empty and malformed values", () => {
    expect(mountedFolders(undefined)).toEqual({ roots: [], names: [] });
    expect(mountedFolders("nonsense,/a:/home/atlas/x")).toEqual({ roots: [], names: [] });
  });
});

describe("asksAboutOwnFiles", () => {
  it.each([
    "what are the main git repos in my WSL home folder?",
    "List my repositories",
    "what's in ~/projects?",
    "quels sont mes d\u00e9p\u00f4ts git ?",
    "regarde dans mon dossier personnel",
  ])("matches %s", (text) => expect(asksAboutOwnFiles(text)).toBe(true));
  it.each(["what's the weather?", "write a poem about rivers", "summarize this article"])(
    "ignores %s",
    (text) => expect(asksAboutOwnFiles(text)).toBe(false),
  );
});

describe("ownFilesNote", () => {
  const ask = "what are the main git repos in my WSL home folder?";
  it("names the mount folder, its repos and the ls to run", () => {
    const note = ownFilesNote(ask, { shellOffered: true, mounts: MOUNTS });
    expect(note).toContain("/mnt/naoufel, /mnt/shared");
    expect(note).toContain("canopy, casino");
    expect(note).toContain("Run ls /mnt/naoufel with the shell tool");
    expect(note).toContain("never say they aren't mounted");
  });
  it("stays silent without mounts, without the shell, on calls, or off topic", () => {
    expect(ownFilesNote(ask, { shellOffered: true })).toBeUndefined();
    expect(ownFilesNote(ask, { shellOffered: false, mounts: MOUNTS })).toBeUndefined();
    expect(
      ownFilesNote(ask, { shellOffered: true, mounts: MOUNTS, voiceCall: true }),
    ).toBeUndefined();
    expect(ownFilesNote("tell me a joke", { shellOffered: true, mounts: MOUNTS })).toBeUndefined();
  });
});
