import { GROUP_MEMBER_MAX } from "@atlas/contracts";
import { describe, expect, it } from "vitest";
import { isBotDescendant, resolveRosterDrop } from "./roster-drop";

const bot = (id: string, sectionId: string | null, pinned = false) => ({
  id,
  sectionId,
  pinned,
});
const group = (id: string, sectionId: string | null, memberIds: string[]) => ({
  id,
  sectionId,
  memberIds,
});

describe("resolveRosterDrop", () => {
  it("reorders when the bot is dropped on a sibling in the same section", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", "s1"),
        target: { kind: "bot", chat: bot("b", "s1") },
        sameList: true,
      }),
    ).toEqual({ action: "reorder", targetBotId: "b" });
  });

  it("refuses a reorder across tree levels inside one section", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", "s1"),
        target: { kind: "bot", chat: bot("b", "s1") },
        sameList: false,
      }),
    ).toBeNull();
  });

  it("moves to the target bot's section when the sections differ", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", "s1"),
        target: { kind: "bot", chat: bot("b", "s2") },
        sameList: false,
      }),
    ).toEqual({ action: "move", sectionId: "s2" });
    expect(
      resolveRosterDrop({
        dragged: bot("a", "s1"),
        target: { kind: "bot", chat: bot("b", null) },
        sameList: false,
      }),
    ).toEqual({ action: "move", sectionId: null });
  });

  it("moves to a section header, including Unassigned", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", null),
        target: { kind: "section", sectionId: "s2" },
        sameList: false,
      }),
    ).toEqual({ action: "move", sectionId: "s2" });
    expect(
      resolveRosterDrop({
        dragged: bot("a", "s1"),
        target: { kind: "section", sectionId: null },
        sameList: false,
      }),
    ).toEqual({ action: "move", sectionId: null });
  });

  it("does nothing when dropped on the header of its own section", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", "s1"),
        target: { kind: "section", sectionId: "s1" },
        sameList: false,
      }),
    ).toBeNull();
  });

  it("never moves a pinned bot into a section; pinned rows only reorder", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", null, true),
        target: { kind: "section", sectionId: "s2" },
        sameList: false,
      }),
    ).toBeNull();
    expect(
      resolveRosterDrop({
        dragged: bot("a", null, true),
        target: { kind: "bot", chat: bot("b", "s2") },
        sameList: false,
      }),
    ).toBeNull();
  });

  it("joins a group chat when dropped on it", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", "s1"),
        target: { kind: "group", chat: group("g1", null, ["b", "c"]) },
        sameList: false,
      }),
    ).toEqual({ action: "join", groupId: "g1", botIds: ["b", "c", "a"] });
  });

  it("refuses to join a group it already belongs to or one that is full", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", null),
        target: { kind: "group", chat: group("g1", null, ["a", "b"]) },
        sameList: false,
      }),
    ).toBeNull();
    expect(
      resolveRosterDrop({
        dragged: bot("z", null),
        target: {
          kind: "group",
          chat: group(
            "g1",
            null,
            Array.from({ length: GROUP_MEMBER_MAX }, (_, i) => `m${i}`),
          ),
        },
        sameList: false,
      }),
    ).toBeNull();
  });

  it("ignores a drop on itself", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", "s1"),
        target: { kind: "bot", chat: bot("a", "s1") },
        sameList: true,
      }),
    ).toBeNull();
  });
});

describe("resolveRosterDrop nesting and spaces", () => {
  const tree = [
    { id: "a", parentBotId: null },
    { id: "b", parentBotId: "a" },
    { id: "c", parentBotId: "b" },
    { id: "d", parentBotId: null },
  ];
  const nestOn = (id: string) => ({ kind: "bot" as const, chat: bot(id, "s1"), nest: true });

  it("nests the dragged bot under the bot it is dropped on", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("d", "s2"),
        target: nestOn("a"),
        sameList: false,
        bots: tree,
      }),
    ).toEqual({ action: "parent", parentBotId: "a" });
  });

  it("refuses nesting onto itself, its current parent, or a descendant", () => {
    const a = { ...bot("a", "s1"), parentBotId: null };
    const c = { ...bot("c", "s1"), parentBotId: "b" };
    expect(
      resolveRosterDrop({ dragged: a, target: nestOn("a"), sameList: true, bots: tree }),
    ).toBeNull();
    expect(
      resolveRosterDrop({ dragged: c, target: nestOn("b"), sameList: true, bots: tree }),
    ).toBeNull();
    expect(
      resolveRosterDrop({ dragged: a, target: nestOn("c"), sameList: true, bots: tree }),
    ).toBeNull();
  });

  it("refuses nesting and space moves while the bot is working", () => {
    const busy = { ...bot("d", "s1"), status: "running", spaceId: "sp1" };
    expect(
      resolveRosterDrop({ dragged: busy, target: nestOn("a"), sameList: true, bots: tree }),
    ).toBeNull();
    expect(
      resolveRosterDrop({
        dragged: busy,
        target: { kind: "space", spaceId: "sp2", spaceName: "Two" },
        sameList: false,
      }),
    ).toBeNull();
  });

  it("moves to another space but not to its own", () => {
    const idle = { ...bot("d", "s1"), status: "idle", spaceId: "sp1" };
    expect(
      resolveRosterDrop({
        dragged: idle,
        target: { kind: "space", spaceId: "sp2", spaceName: "Two" },
        sameList: false,
      }),
    ).toEqual({ action: "space", spaceId: "sp2", spaceName: "Two" });
    expect(
      resolveRosterDrop({
        dragged: idle,
        target: { kind: "space", spaceId: "sp1", spaceName: "One" },
        sameList: false,
      }),
    ).toBeNull();
  });

  it("keeps edge drops reordering and moving sections", () => {
    expect(
      resolveRosterDrop({
        dragged: bot("a", "s1"),
        target: { kind: "bot", chat: bot("d", "s1") },
        sameList: true,
      }),
    ).toEqual({ action: "reorder", targetBotId: "d" });
  });
});

describe("isBotDescendant", () => {
  it("walks the parent chain and survives cycles", () => {
    const cyclic = [
      { id: "x", parentBotId: "y" },
      { id: "y", parentBotId: "x" },
    ];
    expect(isBotDescendant(cyclic, "x", "z")).toBe(false);
    expect(isBotDescendant([{ id: "b", parentBotId: "a" }], "b", "a")).toBe(true);
  });
});
