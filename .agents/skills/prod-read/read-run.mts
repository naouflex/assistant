import { createDb, runAsSystem } from "@atlas/db";

const runId = process.env.ATLAS_RUN_ID!;
const { prisma, pool } = createDb(process.env.DATABASE_URL!);

await runAsSystem("read run", async () => {
  const run = await prisma.run.findUniqueOrThrow({
    where: { id: runId },
    select: {
      status: true, leaseOwner: true, leaseExpiresAt: true, wakeAt: true, startedAt: true,
      updatedAt: true, checkpoint: true, error: true, modelId: true,
      attempts: { select: { fence: true, status: true, error: true, startedAt: true, finishedAt: true } },
    },
  });
  console.log(JSON.stringify({ ...run, checkpoint: run.checkpoint?.slice(0, 300) }, null, 1));
  const events = await prisma.event.findMany({
    where: { runId },
    orderBy: { seq: "desc" },
    take: 25,
    select: { seq: true, type: true, payload: true, createdAt: true },
  });
  for (const e of events.reverse())
    console.log(`${e.createdAt.toISOString()} #${e.seq} ${e.type} ${JSON.stringify(e.payload).slice(0, 400)}`);
});

await pool.end();
