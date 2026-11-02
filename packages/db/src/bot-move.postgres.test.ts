import { randomBytes } from "node:crypto";
import type { MessageBlock } from "@atlas/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BotMoveError, moveBotToSpace, planBotMove, setBotParent } from "./bot-move.js";
import type { PrismaClient } from "./client.js";
import { createDb } from "./client.js";
import { LocalKeyProvider, masterKeysFromEnv } from "./content-keys.js";
import { createThreadMessage } from "./messages.js";
import { runAsSystem } from "./row-security.js";

const databaseUrl = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE && databaseUrl ? describe.sequential : describe.skip;

const master = { id: "move-test", key: randomBytes(32) };

describePostgres("bot move (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const userId = `move-user-${suffix}`;
  const organizationId = `move-org-${suffix}`;
  const fromSpace = `move-from-${suffix}`;
  const toSpace = `move-to-${suffix}`;
  const botId = `move-bot-${suffix}`;
  const childId = `move-child-${suffix}`;
  const threadId = `move-thread-${suffix}`;
  const clients: Array<ReturnType<typeof createDb>> = [];
  let prisma: PrismaClient;

  function client() {
    const db = createDb(databaseUrl!, {
      keyProvider: new LocalKeyProvider([master, ...masterKeysFromEnv()]),
      encryptContent: true,
    });
    clients.push(db);
    return db;
  }

  beforeAll(() =>
    runAsSystem("test fixture", async () => {
      ({ prisma } = client());
      await prisma.user.create({
        data: { id: userId, name: "Mover", email: `${userId}@atlas.test`, emailVerified: false },
      });
      await prisma.organization.create({
        data: { id: organizationId, name: "Move", slug: organizationId, createdAt: new Date() },
      });
      await prisma.member.create({
        data: { id: `m-${suffix}`, organizationId, userId, role: "owner", createdAt: new Date() },
      });
      for (const id of [fromSpace, toSpace]) {
        await prisma.space.create({ data: { id, organizationId, name: id } });
        await prisma.spaceMember.create({
          data: { id: `sm-${id}`, spaceId: id, organizationId, userId, createdAt: new Date() },
        });
      }
      const section = await prisma.botSection.create({
        data: { spaceId: fromSpace, userId, name: "Work" },
      });
      await prisma.bot.create({
        data: {
          id: botId,
          spaceId: fromSpace,
          userId,
          name: "Mover",
          color: "ink",
          sectionId: section.id,
        },
      });
      await prisma.bot.create({
        data: {
          id: childId,
          spaceId: fromSpace,
          userId,
          name: "Child",
          color: "ink",
          parentBotId: botId,
        },
      });
      await prisma.thread.create({ data: { id: threadId, spaceId: fromSpace, userId, botId } });
    }),
  );

  afterAll(async () => {
    await runAsSystem("test fixture", async () => {
      await prisma?.organization.deleteMany({ where: { id: organizationId } });
      await prisma?.user.deleteMany({ where: { id: userId } });
    });
    for (const db of clients) {
      await db.prisma.$disconnect();
      await db.pool.end();
    }
  });

  it("moves a bot with its children and keeps its content readable in the new space", () =>
    runAsSystem("test fixture", async () => {
      const blocks: MessageBlock[] = [{ kind: "text", text: "The codeword is MARIGOLD" }];
      const message = await createThreadMessage(prisma, { threadId, role: "user", blocks });
      const memory = await prisma.memoryDocument.create({
        data: {
          spaceId: fromSpace,
          userId,
          botId,
          scope: "bot",
          path: "notes.md",
          content: "Prefers tea",
        },
      });

      const plan = await planBotMove(prisma, { userId, botId, targetSpaceId: toSpace });
      expect(plan.botIds).toEqual([botId, childId]);
      await moveBotToSpace(prisma, plan);

      // A fresh client has no cached row spaces, like another process would.
      const { prisma: fresh } = client();
      const bots = await fresh.bot.findMany({
        where: { id: { in: [botId, childId] } },
        select: { id: true, spaceId: true, sectionId: true, parentBotId: true },
        orderBy: { name: "desc" },
      });
      expect(bots).toEqual([
        { id: botId, spaceId: toSpace, sectionId: null, parentBotId: null },
        { id: childId, spaceId: toSpace, sectionId: null, parentBotId: botId },
      ]);
      const moved = await fresh.message.findUnique({ where: { id: message.id } });
      expect(moved?.blocks).toEqual(blocks);
      const doc = await fresh.memoryDocument.findUnique({ where: { id: memory.id } });
      expect(doc).toMatchObject({ spaceId: toSpace, content: "Prefers tea" });
      const thread = await fresh.thread.findUnique({ where: { id: threadId } });
      expect(thread?.spaceId).toBe(toSpace);
    }));

  it("refuses moving into the space it is already in", () =>
    runAsSystem("test fixture", async () => {
      await expect(
        planBotMove(prisma, { userId, botId, targetSpaceId: toSpace }),
      ).rejects.toBeInstanceOf(BotMoveError);
    }));

  it("changes the parent and refuses a loop", () =>
    runAsSystem("test fixture", async () => {
      await expect(
        setBotParent(prisma, { userId, botId, parentBotId: childId }),
      ).rejects.toBeInstanceOf(BotMoveError);
      await setBotParent(prisma, { userId, botId: childId, parentBotId: null });
      const child = await prisma.bot.findUnique({ where: { id: childId } });
      expect(child?.parentBotId).toBeNull();
    }));
});
