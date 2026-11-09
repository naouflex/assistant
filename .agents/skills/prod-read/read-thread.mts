import { createDb, runAsSystem } from "@atlas/db";

const botName = (process.env.ATLAS_BOT_NAME ?? "Atlas Dev").trim();
const take = Number(process.env.ATLAS_TAKE ?? 10);
const { prisma, pool } = createDb(process.env.DATABASE_URL!);

await runAsSystem("read bot thread", async () => {
  const bot = await prisma.bot.findFirstOrThrow({
    where: { name: botName, archivedAt: null },
    select: { id: true },
  });
  const thread = await prisma.thread.findFirstOrThrow({
    where: { botId: bot.id, groupId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const messages = await prisma.message.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take,
  });
  for (const m of messages.reverse()) {
    const text = (m.blocks as { kind: string; text?: string }[])
      .map((b) => b.text ?? `[${b.kind}]`)
      .join("\n");
    console.log(`--- ${m.createdAt.toISOString()} ${m.role}\n${text}`);
  }
  const runs = await prisma.run.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, createdAt: true, status: true, trigger: true, error: true },
  });
  console.log("=== recent runs");
  for (const r of runs) {
    console.log(
      `${r.createdAt.toISOString()} ${r.status} ${r.trigger} ${r.id}${r.error ? ` error=${r.error}` : ""}`,
    );
  }
});

await pool.end();
