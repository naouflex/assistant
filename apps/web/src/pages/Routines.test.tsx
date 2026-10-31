// @vitest-environment jsdom
import type { Bot, Routine } from "@atlas/contracts";
import { expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ routines: { listForMentions: vi.fn() } }));
vi.mock("../lib/rpc", () => ({ rpc }));
vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: unknown }) => children,
  useLingui: () => ({ i18n: { locale: "en" } }),
}));

import { formatRunTime, loadRoutineOverview } from "./Routines";

const bot = (id: string, name: string) => ({ id, name }) as Bot;
const routine = (id: string, botId: string, patch: Partial<Routine>) =>
  ({ id, botId, name: id, active: true, nextRunAt: null, lastRunAt: null, ...patch }) as Routine;

it("lists every bot's routines, soonest next run first and paused ones last", async () => {
  rpc.routines.listForMentions.mockResolvedValueOnce([
    {
      botId: "b1",
      routines: [
        routine("later", "b1", { nextRunAt: "2026-11-02T08:00:00.000Z" }),
        routine("paused", "b1", { active: false, nextRunAt: "2026-11-01T07:00:00.000Z" }),
      ],
    },
    { botId: "b2", routines: [routine("soon", "b2", { nextRunAt: "2026-11-01T08:00:00.000Z" })] },
  ]);

  const rows = await loadRoutineOverview([bot("b1", "Chief"), bot("b2", "Scout")]);

  expect(rpc.routines.listForMentions).toHaveBeenCalledWith({ botIds: ["b1", "b2"] });
  expect(rows.map((row) => [row.bot.name, row.routine.id])).toEqual([
    ["Scout", "soon"],
    ["Chief", "later"],
    ["Chief", "paused"],
  ]);
});

it("shows a dash when a routine has no run time", () => {
  expect(formatRunTime(null, "en")).toBe("\u2014");
  expect(formatRunTime("not a date", "en")).toBe("\u2014");
  expect(formatRunTime("2026-11-01T08:00:00.000Z", "en")).toMatch(/Nov/);
});
