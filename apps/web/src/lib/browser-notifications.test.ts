import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserNotificationApi,
  BrowserNotificationContext,
  RosterNotificationBot,
} from "./browser-notifications.js";
import {
  browserNotificationMessage,
  deliverBrowserNotification,
  focusAppWindow,
  rosterNotificationSnapshot,
  rosterNotifications,
  requestBrowserNotificationPermission,
  shouldNotifyBrowser,
} from "./browser-notifications.js";
import { i18n } from "./i18n.js";

function event(
  overrides: Partial<{
    type:
      | "thread.message.created"
      | "run.completed"
      | "run.failed"
      | "run.cancelled"
      | "run.started";
    threadId: string;
    id: string;
    runId: string;
    seq: number;
    payload: Record<string, unknown>;
  }> = {},
) {
  return {
    type: "thread.message.created" as const,
    id: "event-1",
    threadId: "thread-1",
    runId: "run-1",
    seq: 8,
    payload: { role: "bot", blocks: [{ kind: "text", text: "The pool is balanced." }] },
    ...overrides,
  };
}

function context(overrides: Partial<BrowserNotificationContext> = {}): BrowserNotificationContext {
  return {
    subscribedThreadId: "thread-1",
    initialCursor: 7,
    streamReady: true,
    pageVisible: false,
    windowFocused: false,
    permission: "granted",
    notifiedEventIds: new Set(),
    ...overrides,
  };
}

describe("browser notifications", () => {
  beforeEach(() => {
    i18n.load("en", {
      "{name} failed": "Chief failed",
      "{name} finished": "Chief finished",
      "{name} stopped": "Chief stopped",
      "Failed.": "Failed.",
      "Stopped.": "Stopped.",
      "Finished.": "Finished.",
    });
    i18n.activate("en");
  });

  it("only accepts a new bot message for the hidden or unfocused subscribed thread", () => {
    expect(shouldNotifyBrowser(event(), context())).toBe(true);
    expect(shouldNotifyBrowser(event({ type: "run.started" }), context())).toBe(false);
    expect(shouldNotifyBrowser(event({ type: "run.failed" }), context())).toBe(true);
    expect(shouldNotifyBrowser(event({ type: "run.cancelled" }), context())).toBe(true);
    expect(shouldNotifyBrowser(event({ payload: { role: "user", blocks: [] } }), context())).toBe(
      false,
    );
    expect(shouldNotifyBrowser(event({ type: "run.completed" }), context())).toBe(false);
    expect(shouldNotifyBrowser(event({ threadId: "other-thread" }), context())).toBe(false);
    expect(shouldNotifyBrowser(event({ seq: 7 }), context())).toBe(false);
    expect(shouldNotifyBrowser(event(), context({ pageVisible: true, windowFocused: false }))).toBe(
      true,
    );
    expect(shouldNotifyBrowser(event(), context({ pageVisible: false, windowFocused: true }))).toBe(
      true,
    );
    expect(shouldNotifyBrowser(event(), context({ streamReady: false }))).toBe(false);
    expect(shouldNotifyBrowser(event(), context({ pageVisible: true, windowFocused: true }))).toBe(
      false,
    );
    expect(shouldNotifyBrowser(event(), context({ permission: "default" }))).toBe(false);
    expect(shouldNotifyBrowser(event(), context({ notifiedEventIds: new Set(["event-1"]) }))).toBe(
      false,
    );
  });

  it("puts the bot message in the native notification", () => {
    expect(browserNotificationMessage(event(), "Chief")).toEqual({
      title: "Chief",
      body: "The pool is balanced.",
    });
    expect(
      browserNotificationMessage(
        event({
          payload: {
            role: "bot",
            blocks: [{ kind: "text", text: "| Pool | Total |\n| --- | --- |\n| main | **42** |" }],
          },
        }),
        "Chief",
      ),
    ).toEqual({ title: "Chief", body: "Pool, Total main, 42" });
    expect(browserNotificationMessage(event({ type: "run.failed" }), "Chief")).toEqual({
      title: "Chief failed",
      body: "Failed.",
    });
    expect(browserNotificationMessage(event({ type: "run.cancelled" }), "Chief")).toEqual({
      title: "Chief stopped",
      body: "Stopped.",
    });
  });

  it("dedupes a replay but delivers another message from the same run", () => {
    const notifiedEventIds = new Set<string>();
    const show = vi.fn().mockImplementationOnce(() => {
      throw new Error("notification construction failed");
    });
    const delivery = (permission: "default" | "granted", nextEvent = event()) =>
      deliverBrowserNotification(nextEvent, "Chief", {
        enabled: true,
        pageVisible: false,
        windowFocused: false,
        permission,
        notifiedEventIds,
        show,
      });

    expect(delivery("default")).toBe("pending");
    expect(delivery("granted")).toBe("pending");
    expect(notifiedEventIds).toEqual(new Set());
    expect(delivery("granted")).toBe("delivered");
    expect(notifiedEventIds).toEqual(new Set(["event-1"]));
    expect(show).toHaveBeenLastCalledWith("Chief", "The pool is balanced.", "thread-1");
    expect(delivery("granted")).toBe("discarded");
    expect(delivery("granted", event({ id: "event-2" }))).toBe("delivered");
    expect(show).toHaveBeenCalledTimes(3);
  });

  it("allows a later send gesture to retry a dismissed permission prompt", async () => {
    let resolvePermission: ((permission: "default") => void) | undefined;
    const requestPermission = vi.fn(
      () =>
        new Promise<"default">((resolve) => {
          resolvePermission = resolve;
        }),
    );
    const api: BrowserNotificationApi = { permission: "default", requestPermission };

    requestBrowserNotificationPermission(api);
    requestBrowserNotificationPermission(api);
    expect(requestPermission).toHaveBeenCalledTimes(1);

    resolvePermission?.("default");
    await Promise.resolve();
    requestBrowserNotificationPermission(api);
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });
});

it("uses a readable fallback for opaque notification names", () => {
  expect(browserNotificationMessage(event(), "__TestTok1__").title).toBe("Bot");
});

describe("roster notifications", () => {
  const bot = (over: Partial<RosterNotificationBot> = {}): RosterNotificationBot => ({
    id: "b1",
    name: "Chief",
    unread: false,
    preview: "old",
    notifyOnFinish: true,
    archivedAt: null,
    threadId: "t1",
    ...over,
  });

  it("stays quiet on the first roster so old unread chats do not alert", () => {
    expect(rosterNotifications(null, [bot({ unread: true })], undefined)).toEqual([]);
  });

  it("notifies when another chat gains an unread reply", () => {
    const before = rosterNotificationSnapshot([bot()]);
    const after = [bot({ unread: true, preview: "done" })];
    expect(rosterNotifications(before, after, "other").map((b) => b.id)).toEqual(["b1"]);
  });

  it("notifies again when an unread chat gets a newer reply", () => {
    const before = rosterNotificationSnapshot([bot({ unread: true, preview: "first" })]);
    expect(rosterNotifications(before, [bot({ unread: true, preview: "second" })], undefined)).toHaveLength(1);
    expect(rosterNotifications(before, [bot({ unread: true, preview: "first" })], undefined)).toHaveLength(0);
  });

  it("leaves the open chat, muted bots, archived bots and new bots alone", () => {
    const before = rosterNotificationSnapshot([bot(), bot({ id: "b2" }), bot({ id: "b3" })]);
    const after = [
      bot({ unread: true, preview: "x" }),
      bot({ id: "b2", unread: true, preview: "x", notifyOnFinish: false }),
      bot({ id: "b3", unread: true, preview: "x", archivedAt: "2026-11-07T00:00:00Z" }),
      bot({ id: "b4", unread: true, preview: "x" }),
    ];
    expect(rosterNotifications(before, after, "b1")).toEqual([]);
  });
});

describe("focusAppWindow", () => {
  it("raises the desktop window and the page", () => {
    const focus = vi.fn(async () => undefined);
    const win = { focus: vi.fn() };
    focusAppWindow({ window: { focus } }, win);
    expect(focus).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
  });

  it("still focuses the page on desktop builds without the bridge call", () => {
    const win = { focus: vi.fn() };
    focusAppWindow({ window: {} }, win);
    focusAppWindow(undefined, win);
    expect(win.focus).toHaveBeenCalledTimes(2);
  });
});
