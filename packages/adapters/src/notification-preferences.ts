import type { NotificationMessage } from "@atlas/adapter-kit";
import type { PrismaClient } from "@atlas/db";
import { asSystem } from "@atlas/db";

export type NotificationPreferenceKey = "finish" | "help" | "takeover" | "computer";

export function notificationPreferenceKey(
  kind: NotificationMessage["kind"],
): NotificationPreferenceKey {
  return kind === "completion" || kind === "failure" ? "finish" : kind;
}

/** Allows a push unless the user turned that kind off in the space. */
export function notificationPreferenceGate(prisma: PrismaClient) {
  const db = asSystem(prisma, "push preference lookup");
  return async (message: NotificationMessage, userId: string, spaceId: string) => {
    const preference = await db.notificationPreference.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
      select: { finish: true, help: true, takeover: true, computer: true },
    });
    return preference?.[notificationPreferenceKey(message.kind)] ?? true;
  };
}
