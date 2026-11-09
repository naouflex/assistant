import { createDb, runAsSystem } from "@atlas/db";

const runId = process.env.ATLAS_RUN_ID!;
const { prisma, pool } = createDb(process.env.DATABASE_URL!);

await runAsSystem("read run messages", async () => {
  const events = await prisma.event.findMany({
    where: { runId, type: { in: ["agent.tool.called", "agent.tool.completed", "thread.message.created", "run.completed"] } },
    orderBy: { seq: "asc" },
    select: { seq: true, type: true, payload: true, createdAt: true },
  });
  for (const e of events) {
    const p = e.payload as { name?: string; blocks?: { kind: string; text?: string }[]; outcome?: string };
    const detail = p.blocks
      ? p.blocks.map((b) => `${b.kind}:${(b.text ?? "").slice(0, 80).replace(/\n/g, " ")}`).join(" | ")
      : `${p.name ?? ""} ${p.outcome ?? ""}`;
    console.log(`${e.createdAt.toISOString()} #${e.seq} ${e.type} ${detail}`);
  }
});

await pool.end();
