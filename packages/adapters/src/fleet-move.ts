import type { ArtifactStore } from "@atlas/adapter-kit";
import type { PrismaClient } from "@atlas/db";
import { asSystem, BotMoveError, setBotParent } from "@atlas/db";
import { moveBot } from "./bot-move.js";
import type { FleetRun } from "./fleet-tools.js";

type Refusal = { ok: false; error: string };
type Found<T> = T | Refusal;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function refused<T>(value: Found<T>): value is Refusal {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false;
}

async function findBot(
  prisma: PrismaClient,
  run: FleetRun,
  args: Record<string, unknown>,
  idKey: string,
  nameKey: string,
): Promise<Found<{ id: string; name: string }>> {
  const id = text(args[idKey]);
  const name = text(args[nameKey]);
  if (id && name) return { ok: false, error: `Pass ${idKey} or ${nameKey}, not both.` };
  if (!id && !name) return { ok: false, error: `Pass ${idKey} or ${nameKey}.` };
  const bots = await prisma.bot.findMany({
    where: {
      spaceId: run.spaceId,
      userId: run.userId,
      archivedAt: null,
      ...(id ? { id } : { name }),
    },
    select: { id: true, name: true },
    take: 2,
  });
  if (bots.length > 1)
    return { ok: false, error: `More than one bot is named "${name}". Pass ${idKey} instead.` };
  return bots[0] ?? { ok: false, error: "No such bot in this space. Call list_fleet for ids." };
}

async function findSpace(
  prisma: PrismaClient,
  run: FleetRun,
  args: Record<string, unknown>,
): Promise<Found<{ id: string; name: string }>> {
  const id = text(args.space_id);
  const name = text(args.space_name);
  if (id && name) return { ok: false, error: "Pass space_id or space_name, not both." };
  const spaces = await asSystem(prisma, "fleet move space lookup").space.findMany({
    where: {
      deletingAt: null,
      memberships: { some: { userId: run.userId } },
      ...(id ? { id } : { name }),
    },
    select: { id: true, name: true },
    take: 2,
  });
  if (spaces.length > 1)
    return { ok: false, error: `More than one space is named "${name}". Pass space_id.` };
  return spaces[0] ?? { ok: false, error: "You are not a member of that space." };
}

/** Moves a bot of this space to another space, or changes its parent bot. */
export async function moveFleetBot(
  deps: { prisma: PrismaClient; artifacts?: ArtifactStore },
  run: FleetRun,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const bot = await findBot(deps.prisma, run, args, "bot_id", "bot_name");
  if (refused(bot)) return bot;
  if (bot.id === run.botId) return { ok: false, error: "You cannot move yourself." };
  const toSpace = text(args.space_id) ?? text(args.space_name);
  const toParent = text(args.parent_bot_id) ?? text(args.parent_bot_name);
  const clearParent = args.clear_parent === true;
  if ([toSpace, toParent, clearParent].filter(Boolean).length !== 1)
    return {
      ok: false,
      error:
        "Pass exactly one of space_id/space_name, parent_bot_id/parent_bot_name, clear_parent.",
    };
  try {
    if (toSpace) {
      const space = await findSpace(deps.prisma, run, args);
      if (refused(space)) return space;
      const moved = await moveBot(
        deps,
        { userId: run.userId, botId: bot.id, targetSpaceId: space.id },
        signal,
      );
      return {
        ok: true,
        moved: bot.name,
        space: space.name,
        botsMoved: moved.botIds.length,
        ...(moved.droppedMcpServers ? { mcpServersUnlinked: moved.droppedMcpServers } : {}),
      };
    }
    let parentBotId: string | null = null;
    if (toParent) {
      const parent = await findBot(deps.prisma, run, args, "parent_bot_id", "parent_bot_name");
      if (refused(parent)) return parent;
      parentBotId = parent.id;
    }
    await setBotParent(deps.prisma, { userId: run.userId, botId: bot.id, parentBotId });
    return { ok: true, bot: bot.name, parent: parentBotId ? toParent : null };
  } catch (error) {
    if (error instanceof BotMoveError) return { ok: false, error: error.message };
    throw error;
  }
}
