import type { Bot, ProductEvent } from "@atlas/contracts";
import { displayName, plainTextFromMarkdown } from "@atlas/core";
import type { RefObject } from "react";
import { useCallback, useRef } from "react";
import {
  deliverBrowserNotification as deliverNativeBrowserNotification,
  focusAppWindow,
  type NotificationChatTarget,
  type RosterNotificationSnapshot,
  rosterNotificationSnapshot,
  rosterNotifications,
  shouldNotifyBrowser,
} from "../../lib/browser-notifications";
import { i18n } from "../../lib/i18n";

type PendingBrowserNotification = {
  event: Pick<ProductEvent, "id" | "type" | "threadId" | "botId" | "payload">;
  botId: string;
  botName: string;
  groupNotification: boolean;
  groupId?: string;
};

/**
 * Finished-run notifications, held until the browser grants permission. Clicking one raises the
 * app and opens the chat it came from.
 */
export function useBrowserNotifications(
  botsRef: RefObject<Bot[]>,
  openChat?: (target: NotificationChatTarget) => void,
) {
  const notifiedBrowserEvents = useRef(new Set<string>());
  const pendingBrowserNotifications = useRef(new Map<string, PendingBrowserNotification>());
  const rosterSnapshot = useRef<RosterNotificationSnapshot | null>(null);
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;
  const showClickable = useCallback(
    (title: string, body: string, tag: string, target: NotificationChatTarget) => {
      const notification = new Notification(title, { body, tag });
      notification.onclick = (event) => {
        event.preventDefault?.();
        focusAppWindow();
        openChatRef.current?.(target);
        notification.close();
      };
    },
    [],
  );
  const deliverBrowserNotification = useCallback(
    (pending: PendingBrowserNotification): boolean => {
      const currentBot = botsRef.current.find((bot) => bot.id === pending.botId);
      if (!currentBot || typeof Notification === "undefined") return true;
      const target: NotificationChatTarget = pending.groupId
        ? { groupId: pending.groupId }
        : { botId: pending.botId };
      const result = deliverNativeBrowserNotification(
        pending.event,
        currentBot.name || pending.botName,
        {
          enabled: pending.groupNotification || currentBot.notifyOnFinish,
          pageVisible: document.visibilityState === "visible",
          windowFocused: document.hasFocus(),
          permission: Notification.permission,
          notifiedEventIds: notifiedBrowserEvents.current,
          show: (title, body, tag) => showClickable(title, body, tag, target),
        },
      );
      return result !== "pending";
    },
    [showClickable],
  );
  const flushPendingBrowserNotifications = useCallback(() => {
    for (const [threadId, pending] of pendingBrowserNotifications.current) {
      if (deliverBrowserNotification(pending)) {
        pendingBrowserNotifications.current.delete(threadId);
      }
    }
  }, [deliverBrowserNotification]);
  const notifyBrowserForEvent = useCallback(
    (
      event: Pick<ProductEvent, "id" | "type" | "threadId" | "seq" | "botId" | "payload">,
      subscribedThreadId: string | undefined,
      initialCursor: number,
      streamReady: boolean,
      botName: string,
      enabled: boolean,
      groupNotification: boolean,
      groupId?: string,
    ) => {
      const botId = event.botId;
      if (typeof botId !== "string") return;
      const eligible = shouldNotifyBrowser(event, {
        subscribedThreadId: subscribedThreadId ?? "",
        initialCursor,
        streamReady,
        pageVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
        permission: "granted",
        notifiedEventIds: notifiedBrowserEvents.current,
      });
      if (!eligible || !enabled) return;
      const pending = {
        event,
        botId,
        botName,
        groupNotification,
        groupId,
      } satisfies PendingBrowserNotification;
      if (typeof Notification === "undefined" || Notification.permission === "denied") return;
      if (Notification.permission === "default") {
        pendingBrowserNotifications.current.set(event.threadId, pending);
        return;
      }
      if (deliverBrowserNotification(pending)) {
        pendingBrowserNotifications.current.delete(event.threadId);
      } else {
        pendingBrowserNotifications.current.set(event.threadId, pending);
      }
    },
    [deliverBrowserNotification],
  );
  /** Replies in chats other than the open one only reach this client through the roster poll. */
  const notifyRosterChanges = useCallback(
    (bots: readonly Bot[], openBotId: string | undefined) => {
      const fresh = rosterNotifications(rosterSnapshot.current, bots, openBotId);
      rosterSnapshot.current = rosterNotificationSnapshot(bots);
      if (fresh.length === 0 || typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      if (document.visibilityState === "visible" && document.hasFocus()) return;
      for (const bot of fresh) {
        try {
          showClickable(
            displayName(bot.name, i18n._({ id: "Bot", message: "Bot" })),
            plainTextFromMarkdown(bot.preview).trim() || i18n._({ id: "Message", message: "Message" }),
            bot.threadId,
            { botId: bot.id },
          );
        } catch {
          // A notification the platform refuses must not break the roster refresh.
        }
      }
    },
    [showClickable],
  );
  return { notifyBrowserForEvent, flushPendingBrowserNotifications, notifyRosterChanges };
}
