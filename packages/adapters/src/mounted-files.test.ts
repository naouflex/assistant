import { describe, expect, it } from "vitest";
import {
  asksAboutOwnFiles,
  mentionedMountPaths,
  mountedFolders,
  mountWorkNote,
  outsideWorkspaceFileHint,
  ownFilesNote,
} from "./mounted-files.js";

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
  it.each([
    "what's the weather?",
    "write a poem about rivers",
    "summarize this article",
    "run the tests in WSL",
  ])("ignores %s", (text) => expect(asksAboutOwnFiles(text)).toBe(false));
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

describe("mountWorkNote", () => {
  const mounts = "/home/n/religion-project:/mnt/naoufel/religion-project:rw";
  it("sends the bot's computer to the mount and away from the WSL path", () => {
    const note = mountWorkNote("install it on your computer", { shellOffered: true, mounts });
    expect(note).toContain("shell tool");
    expect(note).toContain("/mnt path in your instructions");
    expect(note).toContain("do not call user_computer_shell");
    expect(mountWorkNote("start religion-project", { shellOffered: true, mounts })).toContain(
      "/mnt/naoufel/religion-project",
    );
    expect(mentionedMountPaths("start religion-project", mounts)).toEqual([
      "/mnt/naoufel/religion-project",
    ]);
  });
  it("turns 'start the project again' into the shell command in the instructions", () => {
    const note = mountWorkNote("start the project again.", {
      shellOffered: true,
      mounts,
      instructions:
        "The only path is /mnt/naoufel/religion-project. Start it with ./start.sh from that directory.",
    });
    expect(note).toContain("Call the shell tool before any sentence");
    expect(note).toContain(
      "cd /mnt/naoufel/religion-project && nohup ./start.sh > /tmp/atlas-start.log 2>&1 &",
    );
    expect(note).toContain("Do not paste a command");
  });
  it("starts a Grok local project on the owner's laptop, not in the bot computer", () => {
    const instructions =
      "You are a local agent on the owner's laptop. The only path is /mnt/naoufel/religion-project. Start it with ./start.sh from that directory.";
    const note = mountWorkNote("run it on my laptop instead", {
      shellOffered: true,
      mounts,
      instructions,
      userComputerPlatform: "win32",
    });
    expect(note).toContain("user_computer_shell");
    expect(note).toContain(
      "wsl -e bash -lc 'cd /home/n/religion-project && nohup ./start.sh --host 0.0.0.0 --port 8000 > /tmp/atlas-start.log 2>&1 &'",
    );
    expect(note).toContain("Do not web_fetch");
    expect(note).not.toContain("Call the shell tool");
    expect(
      mountWorkNote("replay isn't working", {
        shellOffered: true,
        mounts,
        instructions,
        userComputerPlatform: "win32",
      }),
    ).toContain("http://localhost:8000 is their browser");
  });
  it("stays silent for an unrelated turn, a call, or no shell", () => {
    expect(mountWorkNote("what's the weather?", { shellOffered: true, mounts })).toBeUndefined();
    expect(
      mountWorkNote("install it on your computer", { shellOffered: true, mounts, voiceCall: true }),
    ).toBeUndefined();
    expect(
      mountWorkNote("install it on your computer", { shellOffered: false, mounts }),
    ).toBeUndefined();
  });
});

describe("outsideWorkspaceFileHint", () => {
  it("points a mount or a WSL path at shell", () => {
    expect(outsideWorkspaceFileHint("/mnt/naoufel/religion-project")).toContain("Use shell");
    expect(outsideWorkspaceFileHint("/home/naoufel/religion-project")).toContain(
      "not on your computer",
    );
    expect(outsideWorkspaceFileHint("/home/atlas/bots/x")).toBeUndefined();
    expect(outsideWorkspaceFileHint("notes.txt")).toBeUndefined();
  });
});
