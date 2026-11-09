import { createDb, runAsSystem } from "@atlas/db";

const botName = (process.env.ATLAS_BOT_NAME ?? "Atlas Dev").trim();
const dryRun = process.env.DRY_RUN === "1";
const { prisma, pool } = createDb(process.env.DATABASE_URL!);

await runAsSystem("unstick computer", async () => {
  const bot = await prisma.bot.findFirstOrThrow({
    where: { name: botName, archivedAt: null },
    select: { id: true, computer: { select: { id: true, state: true, updatedAt: true } } },
  });
  const computer = bot.computer;
  if (!computer) {
    console.log("no computer");
    return;
  }
  if (computer.state !== "suspending") {
    console.log(`state is ${computer.state}, nothing to do`);
    return;
  }
  const ageMs = Date.now() - computer.updatedAt.getTime();
  if (ageMs < 5 * 60_000) {
    console.log(`suspending claim is only ${Math.round(ageMs / 1000)}s old; refusing`);
    return;
  }
  console.log(
    JSON.stringify({
      computerId: computer.id,
      state: computer.state,
      updatedAt: computer.updatedAt.toISOString(),
      ageMinutes: Math.round(ageMs / 60_000),
      dryRun,
    }),
  );
  if (dryRun) return;
  const cleared = await prisma.computer.updateMany({
    where: { id: computer.id, state: "suspending", updatedAt: computer.updatedAt },
    data: {
      state: "stopped",
      controlHolder: "none",
      controlLeaseId: null,
      controlLeaseExpiresAt: null,
      controlBotId: null,
      controlRunId: null,
      executionRunId: null,
      executionBotId: null,
      executionLeaseExpiresAt: null,
      runningSince: null,
    },
  });
  console.log(`cleared ${cleared.count} row(s)`);
});

await pool.end();
