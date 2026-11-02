import type { RunActivityRow } from "@atlas/contracts";
import { describe, expect, it } from "vitest";
import { type CubicleAgent, cubicleDesks } from "./cubicle";

function bot(overrides: Partial<CubicleAgent> & Pick<CubicleAgent, "id" | "name">): CubicleAgent {
  return {
    status: "idle",
    preview: "",
    runErrorId: null,
    archivedAt: null,
    ...overrides,
  };
}

function run(
  overrides: Partial<RunActivityRow> & Pick<RunActivityRow, "runId" | "botId">,
): RunActivityRow {
  return {
    botName: "Bot",
    groupId: null,
    groupName: null,
    threadId: "thread",
    status: "running",
    trigger: "user",
    notificationsEnabled: false,
    promptSnippet: "",
    agentMessage: null,
    updatedAt: "2026-11-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("cubicle desks", () => {
  it("puts agents that need you ahead of working, failed, and idle ones", () => {
    const desks = cubicleDesks(
      [
        bot({ id: "idle", name: "Ada", preview: "Done with the notes" }),
        bot({ id: "fail", name: "Bea", status: "failed", runErrorId: "err-1" }),
        bot({ id: "work", name: "Cleo", status: "running" }),
        bot({ id: "wait", name: "Dora", status: "waiting_input" }),
        bot({ id: "gone", name: "Eve", archivedAt: "2026-11-01T00:00:00.000Z" }),
      ],
      [
        run({
          runId: "run-work",
          botId: "work",
          promptSnippet: "Summarize the inbox",
          updatedAt: "2026-11-01T12:00:00.000Z",
        }),
        run({
          runId: "run-wait",
          botId: "wait",
          status: "waiting_input",
          promptSnippet: "Which file should I send?",
        }),
      ],
    );
    expect(desks.map((desk) => [desk.name, desk.kind, desk.task])).toEqual([
      ["Dora", "waiting", "Which file should I send?"],
      ["Cleo", "working", "Summarize the inbox"],
      ["Bea", "error", ""],
      ["Ada", "idle", "Done with the notes"],
    ]);
  });

  it("keeps a live run ahead of an older error and ignores background ticket work", () => {
    const desks = cubicleDesks(
      [bot({ id: "bot", name: "Ada", status: "idle", runErrorId: "err-1", preview: "old" })],
      [
        run({
          runId: "ticket",
          botId: "bot",
          trigger: "tickets",
          promptSnippet: "Quiet board work",
          updatedAt: "2026-11-01T13:00:00.000Z",
        }),
        run({
          runId: "older",
          botId: "bot",
          status: "waiting_takeover",
          promptSnippet: "Take the computer",
          updatedAt: "2026-11-01T11:00:00.000Z",
        }),
        run({
          runId: "newer",
          botId: "bot",
          status: "running",
          promptSnippet: "Still typing",
          updatedAt: "2026-11-01T12:00:00.000Z",
        }),
      ],
    );
    expect(desks).toEqual([
      {
        id: "bot",
        name: "Ada",
        kind: "waiting",
        status: "waiting_takeover",
        task: "Take the computer",
      },
    ]);
  });
});
