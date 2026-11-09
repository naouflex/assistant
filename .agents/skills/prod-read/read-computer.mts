import { createDb, runAsSystem } from "@atlas/db";

const botName = (process.env.ATLAS_BOT_NAME ?? "Atlas Dev").trim();
const { prisma, pool } = createDb(process.env.DATABASE_URL!);

await runAsSystem("read bot computer", async () => {
  const bot = await prisma.bot.findFirstOrThrow({
    where: { name: botName, archivedAt: null },
    select: {
      id: true,
      name: true,
      computer: {
        select: {
          id: true,
          kind: true,
          scope: true,
          state: true,
          providerRef: true,
          controlHolder: true,
          controlBotId: true,
          controlLeaseId: true,
          controlLeaseExpiresAt: true,
          controlRunId: true,
          executionRunId: true,
          executionLeaseExpiresAt: true,
          runningSince: true,
          updatedAt: true,
          homeRevisionAt: true,
          executionLeases: {
            where: { expiresAt: { gt: new Date() } },
            select: { runId: true, fence: true, expiresAt: true },
          },
        },
      },
    },
  });
  console.log(JSON.stringify(bot, null, 2));
  if (!bot.computer) return;
  const activeRuns = await prisma.run.findMany({
    where: {
      botId: bot.id,
      status: { in: ["running", "waiting_input", "waiting_takeover", "queued"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      status: true,
      trigger: true,
      leaseOwner: true,
      leaseExpiresAt: true,
      updatedAt: true,
      error: true,
    },
  });
  console.log("=== active runs");
  console.log(JSON.stringify(activeRuns, null, 2));
});

await pool.end();
