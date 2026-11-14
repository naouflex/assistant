/** The focused inbox needs to notice new messages, not mirror every server write. */
export const INBOX_POLL_INTERVAL_MS = 15_000;

/** Activity is a secondary surface; a minute keeps it useful without polling constantly. */
export const ACTIVITY_POLL_INTERVAL_MS = 60_000;

/** A wake-up set in chat reaches the phone's alarms within a minute while the app is open. */
export const ALARM_SYNC_INTERVAL_MS = 60_000;
