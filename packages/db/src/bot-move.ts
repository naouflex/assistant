import { ACTIVE_RUN_STATUSES } from "@atlas/core";
import { ensureComputerRecord } from "./computers.js";
import { contentEncryptionOf } from "./content-encryption.js";
import type { SpaceSource } from "./content-keys.js";
import type { Prisma, PrismaClient } from "./generated/prisma/client.js";
import { asSystem } from "./row-security.js";

/** A move the user can fix: the message says what to do first. */
export class BotMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotMoveError";
  }
}

export interface BotMoveInput {
  userId: string;
  botId: string;
  targetSpaceId: string;
}

export interface BotMoveArtifact {
  id: string;
  spaceId: string;
  storageKey: string;
  name: string;
  mimeType: string;
}

export interface BotMovePlan {
  rootBotId: string;
  sourceSpaceId: string;
  targetSpaceId: string;
  /** The bot and every bot under it, root first. */
  botIds: string[];
  /** Files the bots own in the source space; their bytes must be copied before the move. */
  artifacts: BotMoveArtifact[];
}

export interface BotMoveResult {
  botIds: string[];
  /** Per-bot MCP server links dropped: the servers belong to the source space. */
  droppedMcpServers: number;
  computerId: string;
}

const PAGE = 500;

/** Checks a cross-space move and lists what it carries. Changes nothing. */
export async function planBotMove(prisma: PrismaClient, input: BotMoveInput): Promise<BotMovePlan> {
  const db = asSystem(prisma, "bot move plan");
  const root = await db.bot.findUnique({
    where: { id: input.botId },
    select: { id: true, name: true, spaceId: true, userId: true, archivedAt: true },
  });
  if (!root || root.userId !== input.userId) throw new BotMoveError("Bot not found.");
  if (root.archivedAt) throw new BotMoveError("Restore the bot before moving it.");
  if (root.spaceId === input.targetSpaceId)
    throw new BotMoveError("The bot is already in that space.");
  const member = await db.spaceMember.findFirst({
    where: { spaceId: input.targetSpaceId, userId: input.userId },
    select: { id: true },
  });
  if (!member) throw new BotMoveError("You are not a member of that space.");

  const botIds = [root.id];
  for (let frontier = [root.id]; frontier.length; ) {
    const children = await db.bot.findMany({
      where: { parentBotId: { in: frontier }, spaceId: root.spaceId, id: { notIn: botIds } },
      select: { id: true },
    });
    frontier = children.map((child) => child.id);
    botIds.push(...frontier);
  }
  await assertMovable(db, botIds);
  const artifacts = await db.artifact.findMany({
    where: { botId: { in: botIds }, spaceId: root.spaceId, groupId: null },
    select: { id: true, spaceId: true, storageKey: true, name: true, mimeType: true },
  });
  return {
    rootBotId: root.id,
    sourceSpaceId: root.spaceId,
    targetSpaceId: input.targetSpaceId,
    botIds,
    artifacts,
  };
}

type Db = Pick<
  PrismaClient,
  "run" | "chatGroupMember" | "messagingInstallation" | "messagingIdentity" | "externalConversation"
>;

async function assertMovable(db: Db, botIds: string[]) {
  const [runs, groups, installs, identities, conversations] = await Promise.all([
    db.run.count({ where: { botId: { in: botIds }, status: { in: [...ACTIVE_RUN_STATUSES] } } }),
    db.chatGroupMember.count({ where: { botId: { in: botIds } } }),
    db.messagingInstallation.count({ where: { botId: { in: botIds } } }),
    db.messagingIdentity.count({ where: { botId: { in: botIds } } }),
    db.externalConversation.count({ where: { botId: { in: botIds } } }),
  ]);
  if (runs) throw new BotMoveError("Wait for the bot's work to finish, or stop it, then move it.");
  if (groups) throw new BotMoveError("Remove the bot from its group chats first.");
  if (installs || identities || conversations)
    throw new BotMoveError("Disconnect the bot's messaging channels first.");
}

/**
 * Moves the planned bots to the target space in one transaction. Encrypted
 * content (chat history, events, memory and its revisions, the compaction
 * summary) is read under the source space's key and sealed again under the
 * target's. `artifactKeys` maps artifact ids to their copy in the target space.
 */
export async function moveBotToSpace(
  prisma: PrismaClient,
  plan: BotMovePlan,
  artifactKeys: ReadonlyMap<string, string> = new Map(),
): Promise<BotMoveResult> {
  const db = asSystem(prisma, "bot move");
  const ring = contentEncryptionOf(prisma)?.ring;
  const target = plan.targetSpaceId;
  const moveTo = (source: SpaceSource, id: string, owner: string) =>
    ring?.remember(source, id, { spaceId: target, owner });
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM bots WHERE id = ANY(${plan.botIds}) FOR UPDATE`;
        await assertMovable(tx, plan.botIds);
        const bots = await tx.bot.findMany({
          where: { id: { in: plan.botIds } },
          select: {
            id: true,
            spaceId: true,
            userId: true,
            spawnKey: true,
            webhookSecretId: true,
            computer: { select: { kind: true } },
          },
        });
        if (
          bots.length !== plan.botIds.length ||
          bots.some((b) => b.spaceId !== plan.sourceSpaceId)
        )
          throw new BotMoveError("The bot changed while moving. Try again.");
        const root = bots.find((bot) => bot.id === plan.rootBotId)!;
        const where = { botId: { in: plan.botIds } };

        const threads = await tx.thread.findMany({
          where: { ...where, spaceId: plan.sourceSpaceId },
          select: { id: true, userId: true, historyCompactionSummary: true },
        });
        const threadIds = threads.map((thread) => thread.id);
        await resealMessages(tx, threadIds, moveTo);
        await resealEvents(tx, threadIds, target, moveTo);
        for (const thread of threads) {
          moveTo("threads", thread.id, thread.userId);
          await tx.thread.update({
            where: { id: thread.id },
            data: { spaceId: target, historyCompactionSummary: thread.historyCompactionSummary },
          });
        }

        const documents = await tx.memoryDocument.findMany({
          where: { ...where, spaceId: plan.sourceSpaceId },
          select: { id: true, userId: true, content: true },
        });
        await resealRevisions(
          tx,
          documents.map((document) => document.id),
          moveTo,
        );
        for (const document of documents) {
          moveTo("memory_documents", document.id, document.userId);
          await tx.memoryDocument.update({
            where: { id: document.id },
            data: { spaceId: target, content: document.content },
          });
        }

        const space = { spaceId: target };
        await tx.run.updateMany({ where: { threadId: { in: threadIds } }, data: space });
        await tx.task.updateMany({ where, data: space });
        await tx.routine.updateMany({ where, data: space });
        await tx.scratchpadItem.updateMany({ where, data: space });
        await tx.taughtSkill.updateMany({ where, data: space });
        await tx.memoryDream.updateMany({ where, data: space });
        await tx.memoryProposal.updateMany({ where, data: space });
        await tx.agentHome.updateMany({ where, data: space });
        await tx.botSecret.updateMany({ where, data: space });
        const profiles = await tx.browserProfile.findMany({ where, select: { secretId: true } });
        await tx.browserProfile.updateMany({ where, data: space });
        const secretIds = [
          ...profiles.map((profile) => profile.secretId),
          ...bots.map((bot) => bot.webhookSecretId),
        ].filter((id): id is string => Boolean(id));
        if (secretIds.length)
          await tx.secret.updateMany({ where: { id: { in: secretIds } }, data: space });
        const dropped = await tx.botMcpServer.deleteMany({ where });
        for (const [id, storageKey] of artifactKeys)
          await tx.artifact.updateMany({
            where: { id, botId: { in: plan.botIds }, spaceId: plan.sourceSpaceId },
            data: { spaceId: target, storageKey },
          });

        const kind = root.computer?.kind ?? process.env.SANDBOX_PROVIDER ?? "docker";
        const computer = await ensureComputerRecord(tx, {
          mode: "team",
          spaceId: target,
          userId: root.userId,
          kind,
        });
        const taken = new Set(
          (
            await tx.bot.findMany({
              where: {
                spaceId: target,
                spawnKey: { in: bots.flatMap((bot) => (bot.spawnKey ? [bot.spawnKey] : [])) },
              },
              select: { spawnKey: true },
            })
          ).map((bot) => bot.spawnKey),
        );
        for (const bot of bots) {
          await tx.bot.update({
            where: { id: bot.id },
            data: {
              spaceId: target,
              sectionId: null,
              pinned: false,
              computerId: computer.id,
              ...(bot.id === plan.rootBotId ? { parentBotId: null } : {}),
              ...(bot.spawnKey && taken.has(bot.spawnKey) ? { spawnKey: null } : {}),
            },
          });
        }
        return { botIds: plan.botIds, droppedMcpServers: dropped.count, computerId: computer.id };
      },
      { timeout: 10 * 60_000, maxWait: 30_000 },
    );
  } catch (error) {
    // Rows remembered under the target space were rolled back.
    ring?.forget(target);
    ring?.forget(plan.sourceSpaceId);
    throw error;
  }
}

type Tx = Prisma.TransactionClient;
type MoveTo = (source: SpaceSource, id: string, owner: string) => void;

async function resealMessages(tx: Tx, threadIds: string[], moveTo: MoveTo) {
  for (let cursor: string | undefined; ; ) {
    const page = await tx.message.findMany({
      where: { threadId: { in: threadIds }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: PAGE,
      select: { id: true, threadId: true, blocks: true },
    });
    for (const message of page) {
      moveTo("messages", message.id, message.threadId);
      await tx.message.update({
        where: { id: message.id },
        data: { blocks: message.blocks as Prisma.InputJsonValue },
        // The thread still points at the old space, so the new ciphertext cannot be read back yet.
        select: { id: true },
      });
    }
    if (page.length < PAGE) return;
    cursor = page.at(-1)!.id;
  }
}

async function resealEvents(tx: Tx, threadIds: string[], target: string, moveTo: MoveTo) {
  for (let cursor: string | undefined; ; ) {
    const page = await tx.event.findMany({
      where: { threadId: { in: threadIds }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: PAGE,
      select: { id: true, threadId: true, payload: true },
    });
    for (const event of page) {
      moveTo("events", event.id, event.threadId);
      await tx.event.update({
        where: { id: event.id },
        data: { spaceId: target, payload: event.payload as Prisma.InputJsonValue },
        select: { id: true },
      });
    }
    if (page.length < PAGE) return;
    cursor = page.at(-1)!.id;
  }
}

async function resealRevisions(tx: Tx, documentIds: string[], moveTo: MoveTo) {
  for (let cursor: string | undefined; ; ) {
    const page = await tx.memoryRevision.findMany({
      where: { documentId: { in: documentIds }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: PAGE,
      select: { id: true, documentId: true, content: true },
    });
    for (const revision of page) {
      moveTo("memory_revisions", revision.id, revision.documentId);
      await tx.memoryRevision.update({
        where: { id: revision.id },
        data: { content: revision.content },
        select: { id: true },
      });
    }
    if (page.length < PAGE) return;
    cursor = page.at(-1)!.id;
  }
}

/** Sets or clears a bot's parent within its space, refusing a cycle. */
export async function setBotParent(
  prisma: PrismaClient,
  input: { userId: string; botId: string; parentBotId: string | null },
) {
  const db = asSystem(prisma, "bot parent change");
  const bot = await db.bot.findUnique({
    where: { id: input.botId },
    select: { id: true, spaceId: true, userId: true },
  });
  if (!bot || bot.userId !== input.userId) throw new BotMoveError("Bot not found.");
  if (input.parentBotId) {
    if (input.parentBotId === bot.id) throw new BotMoveError("A bot cannot be its own parent.");
    for (let id: string | null = input.parentBotId; id; ) {
      const parent: {
        id: string;
        spaceId: string;
        parentBotId: string | null;
        archivedAt: Date | null;
      } | null = await db.bot.findUnique({
        where: { id },
        select: { id: true, spaceId: true, parentBotId: true, archivedAt: true },
      });
      if (!parent || parent.spaceId !== bot.spaceId)
        throw new BotMoveError("The new parent must be a bot in the same space.");
      if (id === input.parentBotId && parent.archivedAt)
        throw new BotMoveError("The new parent is archived.");
      if (parent.parentBotId === bot.id)
        throw new BotMoveError("That would make the bot its own ancestor.");
      id = parent.parentBotId;
    }
  }
  await db.bot.update({ where: { id: bot.id }, data: { parentBotId: input.parentBotId } });
}
