import type { Routine } from "@atlas/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ setAlarms: vi.fn(async (_alarms: unknown[]) => undefined) }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => native }));
vi.mock("./api", () => ({ rpc }));
vi.mock("./i18n", () => ({
  t: (message: string, values?: Record<string, string>) =>
    message.replace(/\{(\w+)\}/g, (_, key: string) => values?.[key] ?? ""),
}));

const { alarmsFromRoutines, isWakeUp, syncPhoneAlarms } = await import("./alarm-sync");

const NOW = Date.parse("2026-11-14T20:00:00Z");

function routine(over: Partial<Routine>): Routine {
  return {
    id: "r1",
    botId: "b1",
    name: "Stretch",
    prompt: "Remind the user to stretch.",
    crons: ["@once"],
    timezone: "Europe/Paris",
    active: true,
    notify: true,
    webhookEnabled: false,
    githubEnabled: false,
    messageProvider: null,
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    watch: null,
    watchState: null,
    lastRunAt: null,
    nextRunAt: "2026-11-14T21:00:00Z",
    createdAt: "2026-11-14T19:00:00Z",
    ...over,
  } as Routine;
}

describe("phone alarms", () => {
  beforeEach(() => {
    native.setAlarms.mockClear();
    rpc.mockReset();
  });

  it("tells a wake-up from a plain reminder", () => {
    expect(isWakeUp({ name: "Wake up", prompt: "x" })).toBe(true);
    expect(isWakeUp({ name: "Réveil", prompt: "x" })).toBe(true);
    expect(isWakeUp({ name: "Morning", prompt: "Call the user with call_user." })).toBe(true);
    expect(isWakeUp({ name: "Stretch", prompt: "Remind the user to stretch." })).toBe(false);
    expect(isWakeUp({ name: "Awakening novel notes", prompt: "Summarise." })).toBe(false);
  });

  it("copies one-time reminders and the next recurring wake-up, nothing else", () => {
    const alarms = alarmsFromRoutines(
      [
        {
          id: "b1",
          name: "Chief",
          routines: [
            routine({}),
            routine({
              id: "r2",
              name: "Wake up",
              crons: ["0 7 * * 1-5"],
              nextRunAt: "2026-11-16T06:00:00Z",
            }),
            routine({ id: "r3", name: "Daily digest", crons: ["0 8 * * *"] }),
            routine({ id: "r4", active: false }),
            routine({ id: "r5", nextRunAt: "2026-11-14T19:59:00Z" }),
            routine({ id: "r6", nextRunAt: null }),
            routine({ id: "r7", nextRunAt: "2026-12-30T08:00:00Z" }),
          ],
        },
      ],
      NOW,
    );
    expect(alarms).toEqual([
      {
        id: `r1@${Date.parse("2026-11-14T21:00:00Z")}`,
        atMs: Date.parse("2026-11-14T21:00:00Z"),
        title: "Stretch",
        body: "Reminder from Chief",
        wake: false,
      },
      {
        id: `r2@${Date.parse("2026-11-16T06:00:00Z")}`,
        atMs: Date.parse("2026-11-16T06:00:00Z"),
        title: "Wake up",
        body: "Chief is waking you up",
        wake: true,
      },
    ]);
  });

  it("sets the phone's alarms from every bot's schedule", async () => {
    rpc.mockImplementation(async (method: string) =>
      method === "bots/list"
        ? [{ id: "b1", name: "Chief" }]
        : [
            {
              botId: "b1",
              routines: [routine({ nextRunAt: new Date(Date.now() + 60_000).toISOString() })],
            },
          ],
    );
    await syncPhoneAlarms();
    expect(rpc).toHaveBeenCalledWith("routines/listForMentions", { botIds: ["b1"] });
    expect(native.setAlarms).toHaveBeenCalledTimes(1);
    expect(native.setAlarms.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("keeps the alarms already set when the schedule can't be read", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    await syncPhoneAlarms();
    expect(native.setAlarms).not.toHaveBeenCalled();
  });
});
