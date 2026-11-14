import type { Routine } from "@atlas/contracts";
import { ROUTINE_MENTION_BATCH_MAX } from "@atlas/contracts";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { rpc } from "./api";
import { t } from "./i18n";

/** A reminder or wake-up copied onto the phone, so it goes off at its time without a push. */
export type PhoneAlarm = {
  id: string;
  atMs: number;
  title: string;
  body: string;
  /** Rings like an alarm clock, full screen over the lock screen, until dismissed. */
  wake: boolean;
};

type NativeAlarms = {
  setAlarms(alarms: PhoneAlarm[]): Promise<void>;
  listAlarms(): Promise<PhoneAlarm[]>;
  canScheduleExactAlarms(): boolean;
  canUseFullScreenIntent(): boolean;
  openExactAlarmSettings(): Promise<void>;
  openFullScreenIntentSettings(): Promise<void>;
};

// Missing on iOS and on Android builds from before alarms were added.
const native =
  Platform.OS === "android" ? requireOptionalNativeModule<NativeAlarms>("AtlasAlarms") : null;

/** How far ahead alarms are copied; a sync runs each time the app opens. */
export const ALARM_HORIZON_MS = 8 * 24 * 60 * 60_000;

const WAKE_WORDS =
  /\b(wake|waking|alarm|r[ée]veil|r[ée]veille[rz]?|despierta|weck|call_user)\b|\bring (me|the user)\b/i;

/** A wake-up rings; a bot says so in the routine's name or in the prompt it gave itself. */
export function isWakeUp(routine: Pick<Routine, "name" | "prompt">): boolean {
  return WAKE_WORDS.test(routine.name) || WAKE_WORDS.test(routine.prompt);
}

/**
 * The alarms for what the bots scheduled: every one-time reminder, and the next time of a
 * recurring wake-up. Other recurring routines (digests, checks) stay notifications from the server.
 */
export function alarmsFromRoutines(
  bots: Array<{ id: string; name: string; routines: Routine[] }>,
  now: number,
): PhoneAlarm[] {
  const alarms: PhoneAlarm[] = [];
  for (const bot of bots) {
    for (const routine of bot.routines) {
      if (!routine.active || !routine.nextRunAt || routine.watch) continue;
      const atMs = Date.parse(routine.nextRunAt);
      if (!Number.isFinite(atMs) || atMs <= now || atMs - now > ALARM_HORIZON_MS) continue;
      const wake = isWakeUp(routine);
      const once = routine.crons.length > 0 && routine.crons.every((cron) => cron === "@once");
      if (!once && !wake) continue;
      alarms.push({
        id: `${routine.id}@${atMs}`,
        atMs,
        title: routine.name || bot.name,
        body: wake
          ? t("{bot} is waking you up", { bot: bot.name })
          : t("Reminder from {bot}", { bot: bot.name }),
        wake,
      });
    }
  }
  return alarms.sort((a, b) => a.atMs - b.atMs);
}

let running: Promise<void> | null = null;

/** Reads the bots' schedules and sets the phone's alarms to match; quiet when it can't. */
export function syncPhoneAlarms(): Promise<void> {
  if (!native) return Promise.resolve();
  running ??= (async () => {
    try {
      const bots = await rpc("bots/list");
      const names = new Map(bots.map((bot) => [bot.id, bot.name]));
      const lists: Array<{ id: string; name: string; routines: Routine[] }> = [];
      for (let i = 0; i < bots.length; i += ROUTINE_MENTION_BATCH_MAX) {
        const botIds = bots.slice(i, i + ROUTINE_MENTION_BATCH_MAX).map((bot) => bot.id);
        if (!botIds.length) continue;
        for (const row of await rpc("routines/listForMentions", { botIds })) {
          lists.push({ id: row.botId, name: names.get(row.botId) ?? "", routines: row.routines });
        }
      }
      await native?.setAlarms(alarmsFromRoutines(lists, Date.now()));
    } catch {
      // Offline or signed out: the alarms already set stay until the next sync.
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Clears the phone's alarms, for sign-out. */
export async function clearPhoneAlarms(): Promise<void> {
  await native?.setAlarms([]).catch(() => undefined);
}

export const phoneAlarms = {
  available: () => native !== null,
  canScheduleExact: () => native?.canScheduleExactAlarms() ?? true,
  canUseFullScreen: () => native?.canUseFullScreenIntent() ?? true,
  openExactAlarmSettings: () => native?.openExactAlarmSettings(),
  openFullScreenIntentSettings: () => native?.openFullScreenIntentSettings(),
};
