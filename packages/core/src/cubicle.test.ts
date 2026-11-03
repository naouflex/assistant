import type { RunActivityRow } from "@atlas/contracts";
import { describe, expect, it } from "vitest";
import {
  type CubicleAgent,
  cubicleDesks,
  cubicleExchanges,
  cubicleFloor,
  cubicleZoneOrder,
} from "./cubicle.js";

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
        run: expect.objectContaining({ runId: "older" }),
      },
    ]);
  });
});

describe("cubicle exchanges", () => {
  it("lists bot_message runs with peer names and dedupes by run id", () => {
    const exchanges = cubicleExchanges([
      run({
        runId: "peer-1",
        botId: "analyst",
        botName: "Analyst",
        trigger: "bot_message",
        status: "running",
        promptSnippet: "fallback",
        agentMessage: { kind: "request", fromBotName: "Scout", text: "Chart Q3" },
        updatedAt: "2026-11-01T13:00:00.000Z",
      }),
      run({
        runId: "peer-1",
        botId: "analyst",
        botName: "Analyst",
        trigger: "bot_message",
        updatedAt: "2026-11-01T12:00:00.000Z",
      }),
      run({
        runId: "user-1",
        botId: "scout",
        trigger: "user",
        promptSnippet: "Hello",
      }),
    ]);
    expect(exchanges).toEqual([
      {
        runId: "peer-1",
        botId: "analyst",
        botName: "Analyst",
        peerName: "Scout",
        text: "Chart Q3",
        kind: "request",
        status: "running",
        updatedAt: "2026-11-01T13:00:00.000Z",
      },
    ]);
  });

  it("keeps requests ahead of updates and drops empty finished chatter", () => {
    const exchanges = cubicleExchanges([
      run({
        runId: "update",
        botId: "a",
        trigger: "bot_message",
        status: "completed",
        updatedAt: "2026-11-01T14:00:00.000Z",
        agentMessage: { kind: "update", fromBotName: "Scout", text: "Done" },
      }),
      run({
        runId: "ask",
        botId: "b",
        trigger: "bot_message",
        status: "completed",
        updatedAt: "2026-11-01T12:00:00.000Z",
        agentMessage: { kind: "request", fromBotId: "scout", fromBotName: "Scout", text: "Review" },
      }),
      run({
        runId: "blank",
        botId: "c",
        trigger: "bot_message",
        status: "completed",
        promptSnippet: "",
        agentMessage: { kind: "unknown" },
      }),
    ]);
    expect(exchanges.map((exchange) => exchange.runId)).toEqual(["ask", "update"]);
    expect(exchanges[0]?.peerBotId).toBe("scout");
  });

  it("shortens a long desk task to one line", () => {
    const desks = cubicleDesks(
      [bot({ id: "bot", name: "Ada" })],
      [run({ runId: "long", botId: "bot", promptSnippet: "word ".repeat(80) })],
    );
    expect(desks[0]?.task.endsWith("…")).toBe(true);
    expect(desks[0]?.task.length).toBeLessThan(160);
  });

  it("orders floor zones for the UI", () => {
    expect(cubicleZoneOrder()).toEqual(["waiting", "working", "error", "idle"]);
  });

  it("builds one floor per space from that space's bots and runs", () => {
    const floor = cubicleFloor({
      spaceId: "space-dev",
      spaceName: "Dev",
      bots: [bot({ id: "wait", name: "Dora", status: "waiting_input" })],
      active: [
        run({
          runId: "peer-1",
          botId: "wait",
          botName: "Dora",
          status: "waiting_input",
          trigger: "bot_message",
          promptSnippet: "Need a file",
          agentMessage: { kind: "request", fromBotName: "Scout", text: "Need a file" },
        }),
      ],
      recent: [],
    });
    expect(floor.spaceName).toBe("Dev");
    expect(floor.waiting).toBe(1);
    expect(floor.exchanges).toHaveLength(1);
    expect(floor.desks[0]?.kind).toBe("waiting");
  });
});
