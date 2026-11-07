import type { ProductEvent } from "@atlas/contracts";
import { displayName, plainTextFromMarkdown } from "@atlas/core";
import { desktopBridge } from "./desktop";
import { i18n } from "./i18n";

export type BrowserNotificationPermission = "default" | "denied" | "granted";

export type BrowserNotificationApi = {
  readonly permission: BrowserNotificationPermission;
  requestPermission(): Promise<BrowserNotificationPermission>;
};

let permissionRequest: Promise<BrowserNotificationPermission> | null = null;

export function requestBrowserNotificationPermission(
  api: BrowserNotificationApi | undefined = typeof Notification === "undefined"
    ? undefined
    : Notification,
): Promise<BrowserNotificationPermission> | undefined {
  if (!api) return undefined;
  if (api.permission !== "default") return Promise.resolve(api.permission);
  if (permissionRequest) return permissionRequest;
  try {
    permissionRequest = api.requestPermission().then(
      (permission) => {
        permissionRequest = null;
        return permission;
      },
      () => {
        permissionRequest = null;
        return api.permission;
      },
    );
  } catch {
    return Promise.resolve(api.permission);
  }
  return permissionRequest;
}

export type BrowserNotificationContext = {
  subscribedThreadId: string;
  initialCursor: number;
  streamReady: boolean;
  pageVisible: boolean;
  windowFocused: boolean;
  permission: BrowserNotificationPermission;
  notifiedEventIds: ReadonlySet<string>;
};

export function shouldNotifyBrowser(
  event: Pick<ProductEvent, "id" | "type" | "threadId" | "seq" | "payload">,
  context: BrowserNotificationContext,
): boolean {
  const notifiable =
    (event.type === "thread.message.created" && event.payload.role === "bot") ||
    event.type === "run.failed" ||
    event.type === "run.cancelled";
  return (
    context.streamReady &&
    notifiable &&
    event.threadId === context.subscribedThreadId &&
    event.seq > context.initialCursor &&
    (!context.pageVisible || !context.windowFocused) &&
    context.permission === "granted" &&
    !context.notifiedEventIds.has(event.id)
  );
}

export function browserNotificationMessage(
  event: Pick<ProductEvent, "type" | "payload">,
  botName: string,
): { title: string; body: string } {
  const name = displayName(botName, i18n._({ id: "Bot", message: "Bot" }));
  if (event.type === "thread.message.created") {
    const blocks = Array.isArray(event.payload.blocks) ? event.payload.blocks : [];
    const body = blocks
      .map((block) =>
        block && typeof block === "object" && "text" in block && typeof block.text === "string"
          ? plainTextFromMarkdown(block.text)
          : "",
      )
      .filter(Boolean)
      .join("\n")
      .trim();
    return { title: name, body: body || i18n._({ id: "Message", message: "Message" }) };
  }
  if (event.type === "run.failed") {
    return {
      title: i18n._({ id: "{name} failed", message: "{name} failed", values: { name } }),
      body: i18n._({ id: "Failed.", message: "Failed." }),
    };
  }
  if (event.type === "run.cancelled") {
    return {
      title: i18n._({ id: "{name} stopped", message: "{name} stopped", values: { name } }),
      body: i18n._({ id: "Stopped.", message: "Stopped." }),
    };
  }
  return {
    title: i18n._({ id: "{name} finished", message: "{name} finished", values: { name } }),
    body: i18n._({ id: "Finished.", message: "Finished." }),
  };
}

export function deliverBrowserNotification(
  event: Pick<ProductEvent, "id" | "type" | "threadId" | "payload">,
  botName: string,
  context: {
    enabled: boolean;
    pageVisible: boolean;
    windowFocused: boolean;
    permission: BrowserNotificationPermission;
    notifiedEventIds: Set<string>;
    show: (title: string, body: string, tag: string) => void;
  },
): "delivered" | "pending" | "discarded" {
  if (
    !context.enabled ||
    (context.pageVisible && context.windowFocused) ||
    context.notifiedEventIds.has(event.id) ||
    context.permission === "denied"
  ) {
    return "discarded";
  }
  if (context.permission === "default") return "pending";
  const message = browserNotificationMessage(event, botName);
  try {
    context.show(message.title, message.body, event.threadId);
    context.notifiedEventIds.add(event.id);
    return "delivered";
  } catch {
    return "pending";
  }
}

export type NotificationChatTarget = { botId: string } | { groupId: string };

/** Raises the app when a notification is clicked; the desktop app restores a minimized window. */
export function focusAppWindow(
  bridge: { window?: { focus?: () => Promise<void> } } | undefined = desktopBridge(),
  win: { focus(): void } | undefined = typeof window === "undefined" ? undefined : window,
): void {
  void bridge?.window?.focus?.().catch(() => undefined);
  try {
    win?.focus();
  } catch {
    // Some browsers refuse focus outside a user gesture; the notification click still opens the chat.
  }
}

export type RosterNotificationBot = {
  id: string;
  name: string;
  unread: boolean;
  preview: string;
  notifyOnFinish: boolean;
  archivedAt: string | null;
  threadId: string;
};

export type RosterNotificationSnapshot = ReadonlyMap<string, { unread: boolean; preview: string }>;

export function rosterNotificationSnapshot(
  bots: readonly RosterNotificationBot[],
): RosterNotificationSnapshot {
  return new Map(bots.map((bot) => [bot.id, { unread: bot.unread, preview: bot.preview }]));
}

/**
 * Bots whose chat gained an unread reply since the last roster poll. The open chat is left to its
 * live event stream, and the first roster seen only records state, so old unread chats stay quiet.
 */
export function rosterNotifications(
  previous: RosterNotificationSnapshot | null,
  bots: readonly RosterNotificationBot[],
  openBotId: string | undefined,
): RosterNotificationBot[] {
  if (!previous) return [];
  return bots.filter((bot) => {
    const before = previous.get(bot.id);
    return (
      before !== undefined &&
      bot.id !== openBotId &&
      bot.unread &&
      bot.notifyOnFinish &&
      !bot.archivedAt &&
      (!before.unread || before.preview !== bot.preview)
    );
  });
}
