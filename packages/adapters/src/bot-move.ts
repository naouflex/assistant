import { randomUUID } from "node:crypto";
import type { AdapterContext, ArtifactStore } from "@atlas/adapter-kit";
import type { BotMoveResult, PrismaClient } from "@atlas/db";
import { moveBotToSpace, planBotMove } from "@atlas/db";
import { getLogger } from "@atlas/logging";

export interface BotMoveDeps {
  prisma: PrismaClient;
  artifacts?: ArtifactStore;
}

function context(spaceId: string, userId: string, botId: string, signal: AbortSignal) {
  const id = randomUUID();
  return { operationId: id, traceId: id, spaceId, userId, botId, signal } satisfies AdapterContext;
}

/**
 * Moves a bot, and every bot under it, to another of the owner's spaces. Files
 * are copied into the target space first and the source copies removed after
 * the database move commits; a failed move removes the copies instead.
 */
export async function moveBot(
  deps: BotMoveDeps,
  input: { userId: string; botId: string; targetSpaceId: string },
  signal: AbortSignal = new AbortController().signal,
): Promise<BotMoveResult> {
  const plan = await planBotMove(deps.prisma, input);
  const copies = new Map<string, string>();
  const from = context(plan.sourceSpaceId, input.userId, plan.rootBotId, signal);
  const to = context(plan.targetSpaceId, input.userId, plan.rootBotId, signal);
  const store = deps.artifacts;
  try {
    if (store && plan.artifacts.length) {
      for (const artifact of plan.artifacts) {
        const bytes = await store.get(artifact.storageKey, from);
        const copy = await store.put(
          { name: artifact.name, mimeType: artifact.mimeType, bytes },
          to,
        );
        copies.set(artifact.id, copy.id);
      }
    }
    const result = await moveBotToSpace(deps.prisma, plan, copies);
    if (store) {
      for (const artifact of plan.artifacts) {
        if (!copies.has(artifact.id)) continue;
        await store.remove(artifact.storageKey, from).catch((error) => {
          getLogger().warn("moved artifact source not removed", { error: String(error) });
        });
      }
    }
    return result;
  } catch (error) {
    if (store) await Promise.allSettled([...copies.values()].map((key) => store.remove(key, to)));
    throw error;
  }
}
