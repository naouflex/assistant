import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDb, runAsSystem, sendUserMessage } from "@atlas/db";

const file = process.argv[2] ?? "/tmp/handover.md";
const text = readFileSync(file, "utf8").trim();
if (!text) {
  console.error("handover file is empty:", file);
  process.exit(1);
}

const botName = (process.env.ATLAS_BOT_NAME ?? "Atlas Dev").trim();
const { prisma, pool } = createDb(process.env.DATABASE_URL!);

await runAsSystem("atlas dev handover", async () => {
  const bot = await prisma.bot.findFirstOrThrow({
    where: { name: botName, archivedAt: null },
    select: { id: true, spaceId: true, userId: true },
  });
  const thread = await prisma.thread.findFirstOrThrow({
    where: { botId: bot.id, groupId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const result = await sendUserMessage(prisma, {
    spaceId: bot.spaceId,
    threadId: thread.id,
    botId: bot.id,
    userId: bot.userId,
    blocks: [{ kind: "text", text }],
    prompt: text,
    trigger: "user",
    clientNonce: randomUUID(),
  });
  console.log("THREAD", thread.id);
  console.log("RUN", result.runId ?? "");
});

await pool.end();
