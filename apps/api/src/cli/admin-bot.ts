// Server-side admin CLI: list/find bots, export bot profile + durable knowledge records, and apply
// updates through the same persistence paths as the API (no raw SQL). See docs/self-host-admin-bot.md.
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { MEMORY_REVISION_CONFLICT_ERROR } from "@atlas/adapter-kit";
import { contentKeyProviderFromEnv, unwrapEnvFromKeyManager } from "@atlas/adapters";
import type { Actor } from "@atlas/contracts";
import { BOT_INSTRUCTIONS_MAX_LENGTH, InstructionVersionSchema } from "@atlas/contracts";
import {
  InstructionConflictError,
  availableInSpace,
  commitBotUpdate,
  createDb,
  runAsTenant,
} from "@atlas/db";
import { loadRootEnv } from "@atlas/core/node/load-root-env";
import { MarkdownMemoryStore } from "@atlas/memory";
import { createAgentSkillsService } from "../agent-skills.js";
import { redactCliError } from "./admin-bot-errors.js";

const SNAPSHOT_VERSION = 2;
const DEFAULT_BACKUP_DIR = "./admin-bot-backups";

loadRootEnv();
await unwrapEnvFromKeyManager();

function usage(): never {
  process.stderr.write(
    [
      "Usage:",
      "  admin-bot list [--owner-email <email> | --owner-user-id <id>] [--space-id <id>] [--all-spaces]",
      "            [--name-contains <q>] [--exact-name <name>] [--include-archived]",
      "  admin-bot find-bot [--owner-email <email> | --owner-user-id <id>] (--exact-name <name> | --name-contains <q>) [--include-archived]",
      "  admin-bot export [--owner-email <email> | --owner-user-id <id>] --space-id <id> --bot-id <id> --out <file.json>",
      "  admin-bot update-instructions [--owner-email <email> | --owner-user-id <id>] --space-id <id> --bot-id <id> \\",
      "    --instructions-file <path> [--expected-instructions-file <path>] [--apply] [--backup-dir <dir>]",
      "  admin-bot update-memory [--owner-email <email> | --owner-user-id <id>] --space-id <id> --bot-id <id> \\",
      "    (--document-id <id> | --path <relative/path.md>) --content-file <path> \\",
      "    [--expected-revision <n>] [--apply] [--backup-dir <dir>]",
      "  admin-bot update-skill [--owner-email <email> | --owner-user-id <id>] --space-id <id> --skill-id <id> \\",
      "    --skill-file <path> [--apply] [--backup-dir <dir>]",
      "",
      "Dry-run is the default: omit --apply to perform writes. Export/update paths use mode 0600.",
      "Requires DATABASE_URL and the same encryption/key env as the API.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

function requireDbUrl(): string {
  const u = process.env.DATABASE_URL?.trim();
  if (!u) throw new Error("DATABASE_URL is required");
  return u;
}

async function resolveOwnerByEmail(
  prisma: ReturnType<typeof createDb>["prisma"],
  email: string,
) {
  const row = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true },
  });
  if (!row) throw new Error("No user matches --owner-email");
  return row;
}

async function resolveOwnerById(prisma: ReturnType<typeof createDb>["prisma"], userId: string) {
  const row = await prisma.user.findUnique({
    where: { id: userId.trim() },
    select: { id: true, email: true },
  });
  if (!row) throw new Error("No user matches --owner-user-id");
  return row;
}

async function resolveOwner(
  prisma: ReturnType<typeof createDb>["prisma"],
  ownerEmail: string | undefined,
  ownerUserId: string | undefined,
) {
  if (ownerUserId?.trim() && ownerEmail?.trim()) {
    throw new Error("Pass only one of --owner-email or --owner-user-id");
  }
  if (ownerUserId?.trim()) return resolveOwnerById(prisma, ownerUserId);
  if (ownerEmail?.trim()) return resolveOwnerByEmail(prisma, ownerEmail);
  throw new Error("Pass --owner-email or --owner-user-id");
}

async function resolveSpaceId(
  prisma: ReturnType<typeof createDb>["prisma"],
  userId: string,
  explicit: string | undefined,
): Promise<string> {
  if (explicit?.trim()) return explicit.trim();
  const memberships = await prisma.spaceMember.findMany({
    where: { userId },
    select: { spaceId: true },
  });
  if (memberships.length === 0) throw new Error("Owner has no space memberships");
  if (memberships.length > 1) {
    throw new Error("Owner belongs to multiple spaces; pass --space-id explicitly.");
  }
  return memberships[0]!.spaceId;
}

function actorFor(owner: { id: string; email: string }, spaceId: string): Actor {
  return {
    userId: owner.id,
    spaceId,
    email: owner.email,
    isDeploymentOwner: false,
  };
}

async function chmod0600(path: string) {
  await chmod(path, 0o600);
}

async function assertFileMode0600(path: string) {
  const s = await stat(path);
  const mode = s.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`Expected backup/export file mode 0600, got ${mode.toString(8)}`);
  }
}

async function writePrivateJson(path: string, data: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8" });
  await chmod0600(absolute);
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** No thread/WS notify — local CLI; commitBotUpdate still writes bot.updated and instruction history. */
async function noopNotify() {}

type PrismaLike = ReturnType<typeof createDb>["prisma"];

async function loadBotRow(
  prisma: PrismaLike,
  actor: Actor,
  botId: string,
  includeArchived: boolean,
) {
  const bot = await prisma.bot.findFirst({
    where: {
      id: botId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      ...(includeArchived ? {} : { archivedAt: null }),
    },
    include: { thread: { select: { id: true } } },
  });
  if (!bot?.thread)
    throw new Error("Bot not found for this owner and space, or it has no thread");
  return bot;
}

async function knowledgeSnapshot(prisma: PrismaLike, actor: Actor, botId: string) {
  const [taughtSkills, agentSkillRows, proposals, dreams] = await Promise.all([
    prisma.taughtSkill.findMany({
      where: { spaceId: actor.spaceId, userId: actor.userId, botId },
      select: {
        id: true,
        name: true,
        goal: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
    prisma.agentSkill.findMany({
      where: availableInSpace(actor),
      select: {
        id: true,
        name: true,
        description: true,
        source: true,
        content: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.memoryProposal.findMany({
      where: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        botId,
        status: "pending",
      },
      select: {
        id: true,
        scope: true,
        path: true,
        baseRevision: true,
        reason: true,
        source: true,
        status: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.memoryDream.findMany({
      where: { spaceId: actor.spaceId, userId: actor.userId, botId },
      select: {
        id: true,
        status: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return {
    coverageNote:
      "Durable textual knowledge for bots: memory_documents (markdown paths per bot or user scope) via MarkdownMemoryStore — primary admin edit surface. Separate product concepts: TaughtSkill = per-bot recorded playbooks (JSON); AgentSkill = owner SKILL.md recipes available in the space (and optionally allSpaces); MemoryProposal = pending suggested memory edits from dreams (not applied by this CLI); MemoryDream = dream job metadata. External memory providers are not modified here.",
    taughtSkills: taughtSkills.map((s) => ({
      id: s.id,
      name: s.name,
      goal: s.goal,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    agentSkillsInSpace: agentSkillRows.map((s) => ({
      skillId: s.id,
      name: s.name,
      description: s.description,
      source: s.source,
      content: s.content,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
    memoryProposalsPending: proposals.map((p) => ({
      id: p.id,
      scope: p.scope,
      path: p.path,
      baseRevision: p.baseRevision,
      reason: p.reason,
      source: p.source,
      status: p.status,
      content: p.content,
      createdAt: p.createdAt.toISOString(),
    })),
    memoryDreamsRecent: dreams.map((d) => ({
      id: d.id,
      status: d.status,
      error: d.error,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    })),
  };
}

async function buildSnapshot(
  prisma: PrismaLike,
  actor: Actor,
  botId: string,
  includeArchived: boolean,
  label: string,
) {
  const bot = await loadBotRow(prisma, actor, botId, includeArchived);
  const memoryDocs = await prisma.memoryDocument.findMany({
    where: { spaceId: actor.spaceId, userId: actor.userId, botId },
    select: {
      id: true,
      path: true,
      scope: true,
      content: true,
      revision: true,
      updatedAt: true,
    },
    orderBy: [{ path: "asc" }],
  });
  const knowledge = await knowledgeSnapshot(prisma, actor, botId);
  return {
    version: SNAPSHOT_VERSION,
    label,
    exportedAt: new Date().toISOString(),
    spaceId: actor.spaceId,
    userId: actor.userId,
    bot: {
      id: bot.id,
      name: bot.name,
      description: bot.description,
      instructions: bot.instructions,
      instructionHistory: bot.instructionHistory,
      archivedAt: bot.archivedAt?.toISOString() ?? null,
      updatedAt: bot.updatedAt.toISOString(),
    },
    memoryDocuments: memoryDocs.map((d) => ({
      id: d.id,
      path: d.path,
      scope: d.scope,
      revision: d.revision,
      updatedAt: d.updatedAt.toISOString(),
      content: d.content,
    })),
    knowledge,
  };
}

async function backupSnapshot(opts: {
  prisma: PrismaLike;
  actor: Actor;
  botId: string;
  includeArchived: boolean;
  backupDir: string;
  label: string;
}) {
  const { prisma, actor, botId, includeArchived, backupDir, label } = opts;
  const snapshot = await buildSnapshot(prisma, actor, botId, includeArchived, label);
  const dir = resolve(backupDir);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${label}-${botId}-${Date.now()}.json`);
  await writePrivateJson(file, snapshot);
  await assertFileMode0600(file);
  return { file, snapshot };
}

async function cmdList(
  prisma: PrismaLike,
  owner: { id: string; email: string },
  spaceIdIn: string | undefined,
  allSpaces: boolean,
  nameContains: string | undefined,
  exactName: string | undefined,
  includeArchived: boolean,
) {
  if (nameContains?.trim() && exactName?.trim()) {
    throw new Error("Pass only one of --name-contains or --exact-name");
  }
  if (allSpaces) {
    const memberships = await prisma.spaceMember.findMany({
      where: { userId: owner.id },
      select: { spaceId: true },
    });
    const spaces: { spaceId: string; count: number; bots: unknown[] }[] = [];
    for (const { spaceId } of memberships) {
      await runAsTenant({ spaceId, userId: owner.id }, async () => {
        const bots = await prisma.bot.findMany({
          where: {
            spaceId,
            userId: owner.id,
            ...(includeArchived ? {} : { archivedAt: null }),
            ...(exactName?.trim()
              ? { name: exactName.trim() }
              : nameContains?.trim()
                ? { name: { contains: nameContains.trim(), mode: "insensitive" } }
                : {}),
          },
          select: { id: true, name: true, archivedAt: true, updatedAt: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        if (exactName?.trim() && bots.length > 1) {
          throw new Error(
            "Multiple bots share that exact name in one space; use find-bot or list without --exact-name",
          );
        }
        spaces.push({ spaceId, count: bots.length, bots });
      });
    }
    process.stdout.write(`${JSON.stringify({ ownerUserId: owner.id, spaces }, null, 2)}\n`);
    return;
  }

  const spaceId = await resolveSpaceId(prisma, owner.id, spaceIdIn);
  const actor = actorFor(owner, spaceId);
  await runAsTenant({ spaceId: actor.spaceId, userId: actor.userId }, async () => {
    const bots = await prisma.bot.findMany({
      where: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(exactName?.trim()
          ? { name: exactName.trim() }
          : nameContains?.trim()
            ? { name: { contains: nameContains.trim(), mode: "insensitive" } }
            : {}),
      },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        updatedAt: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    if (exactName?.trim() && bots.length > 1) {
      throw new Error(
        "Multiple bots share that exact name in this space; use --bot-id after listing without --exact-name",
      );
    }
    process.stdout.write(
      `${JSON.stringify({ spaceId: actor.spaceId, ownerUserId: owner.id, count: bots.length, bots }, null, 2)}\n`,
    );
  });
}

async function cmdFindBot(
  prisma: PrismaLike,
  owner: { id: string; email: string },
  exactName: string | undefined,
  nameContains: string | undefined,
  includeArchived: boolean,
) {
  if ((!exactName?.trim() && !nameContains?.trim()) || (exactName?.trim() && nameContains?.trim())) {
    throw new Error("Pass exactly one of --exact-name or --name-contains");
  }
  const memberships = await prisma.spaceMember.findMany({
    where: { userId: owner.id },
    select: { spaceId: true },
  });
  const matches: {
    spaceId: string;
    botId: string;
    name: string;
    archivedAt: string | null;
  }[] = [];
  for (const { spaceId } of memberships) {
    await runAsTenant({ spaceId, userId: owner.id }, async () => {
      const bots = await prisma.bot.findMany({
        where: {
          spaceId,
          userId: owner.id,
          ...(includeArchived ? {} : { archivedAt: null }),
          ...(exactName?.trim()
            ? { name: exactName.trim() }
            : { name: { contains: nameContains!.trim(), mode: "insensitive" } }),
        },
        select: { id: true, name: true, archivedAt: true },
      });
      for (const b of bots) {
        matches.push({
          spaceId,
          botId: b.id,
          name: b.name,
          archivedAt: b.archivedAt?.toISOString() ?? null,
        });
      }
    });
  }
  process.stdout.write(`${JSON.stringify({ ownerUserId: owner.id, count: matches.length, matches }, null, 2)}\n`);
}

async function cmdExport(
  prisma: PrismaLike,
  owner: { id: string; email: string },
  spaceIdIn: string | undefined,
  botId: string,
  outFile: string,
  includeArchived: boolean,
) {
  const spaceId = await resolveSpaceId(prisma, owner.id, spaceIdIn);
  const actor = actorFor(owner, spaceId);
  await runAsTenant({ spaceId: actor.spaceId, userId: actor.userId }, async () => {
    const payload = await buildSnapshot(prisma, actor, botId, includeArchived, "export");
    await writePrivateJson(outFile, payload);
    await assertFileMode0600(outFile);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          wrote: resolve(outFile),
          memoryDocuments: payload.memoryDocuments.length,
          knowledge: {
            taughtSkills: payload.knowledge.taughtSkills.length,
            agentSkillsInSpace: payload.knowledge.agentSkillsInSpace.length,
            memoryProposalsPending: payload.knowledge.memoryProposalsPending.length,
            memoryDreamsRecent: payload.knowledge.memoryDreamsRecent.length,
          },
        },
        null,
        2,
      )}\n`,
    );
  });
}

async function cmdUpdateInstructions(
  prisma: PrismaLike,
  options: {
    owner: { id: string; email: string };
    spaceId?: string;
    botId: string;
    instructionsFile: string;
    expectedInstructionsFile?: string;
    apply: boolean;
    backupDir: string;
    includeArchived: boolean;
  },
) {
  const instructionsText = (await readFile(options.instructionsFile, "utf8")).replace(
    /^\uFEFF/,
    "",
  );
  if (instructionsText.length > BOT_INSTRUCTIONS_MAX_LENGTH) {
    throw new Error("Instructions file exceeds maximum length");
  }
  let expectedInstructions: string | undefined;
  if (options.expectedInstructionsFile) {
    expectedInstructions = (await readFile(options.expectedInstructionsFile, "utf8")).replace(
      /^\uFEFF/,
      "",
    );
  }

  const spaceId = await resolveSpaceId(prisma, options.owner.id, options.spaceId);
  const actor = actorFor(options.owner, spaceId);

  await runAsTenant({ spaceId: actor.spaceId, userId: actor.userId }, async () => {
    const botRow = await loadBotRow(prisma, actor, options.botId, options.includeArchived);
    const threadId = botRow.thread!.id;
    const previousInstructions = botRow.instructions;

    if (!options.apply) {
      process.stdout.write(
        `${JSON.stringify(
          {
            dryRun: true,
            botId: options.botId,
            nextInstructionsChars: instructionsText.length,
            nextInstructionsSha256: sha256Hex(instructionsText),
            currentInstructionsSha256: sha256Hex(botRow.instructions),
            expectedInstructionsProvided: Boolean(expectedInstructions),
            wouldBackupTo: resolve(options.backupDir),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    try {
      await commitBotUpdate({
        prisma,
        notify: noopNotify,
        spaceId: actor.spaceId,
        threadId,
        botId: options.botId,
        emitBotUpdated: true,
        expectedInstructions,
        data: { instructions: instructionsText },
      });
    } catch (e) {
      if (e instanceof InstructionConflictError) {
        throw new Error("Instructions conflict: profile changed or expected value mismatch");
      }
      throw e;
    }

    let backupPath: string | null = null;
    try {
      const backup = await backupSnapshot({
        prisma,
        actor,
        botId: options.botId,
        includeArchived: options.includeArchived,
        backupDir: options.backupDir,
        label: "post-instructions",
      });
      backupPath = backup.file;
    } catch (err) {
      try {
        await commitBotUpdate({
          prisma,
          notify: noopNotify,
          spaceId: actor.spaceId,
          threadId,
          botId: options.botId,
          emitBotUpdated: true,
          expectedInstructions: instructionsText,
          data: { instructions: previousInstructions },
        });
      } catch {
        throw new Error(
          "Committed instruction update but backup failed and automatic restore also failed; inspect DB and instruction history",
        );
      }
      throw err;
    }

    const row = await prisma.bot.findUniqueOrThrow({
      where: { id: options.botId },
      select: { instructionHistory: true },
    });
    const history = InstructionVersionSchema.array().parse(row.instructionHistory);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          backup: backupPath,
          botId: options.botId,
          instructionHistoryHeadId: history[0]?.id ?? null,
        },
        null,
        2,
      )}\n`,
    );
  });
}

async function cmdUpdateMemory(
  prisma: PrismaLike,
  options: {
    owner: { id: string; email: string };
    spaceId?: string;
    botId: string;
    documentId?: string;
    path?: string;
    contentFile: string;
    expectedRevision?: number;
    apply: boolean;
    backupDir: string;
    includeArchived: boolean;
  },
) {
  const content = (await readFile(options.contentFile, "utf8")).replace(/^\uFEFF/, "");
  const spaceId = await resolveSpaceId(prisma, options.owner.id, options.spaceId);
  const actor = actorFor(options.owner, spaceId);
  const memory = new MarkdownMemoryStore(prisma);

  await runAsTenant({ spaceId: actor.spaceId, userId: actor.userId }, async () => {
    await loadBotRow(prisma, actor, options.botId, options.includeArchived);

    let docId = options.documentId?.trim();
    let pathIn = options.path?.trim();
    if (!docId && !pathIn) pathIn = "MEMORY.md";

    if (!docId) {
      const found = await prisma.memoryDocument.findFirst({
        where: {
          spaceId: actor.spaceId,
          userId: actor.userId,
          botId: options.botId,
          path: pathIn!,
          scope: "bot",
        },
        select: { id: true, revision: true, content: true },
      });
      if (!found) throw new Error("No bot memory document for that path");
      docId = found.id;
    }

    const doc = await prisma.memoryDocument.findFirst({
      where: {
        id: docId,
        spaceId: actor.spaceId,
        userId: actor.userId,
        botId: options.botId,
      },
      select: { id: true, path: true, scope: true, revision: true, content: true },
    });
    if (!doc) throw new Error("Memory document not found for this bot and owner");

    const previousContent = doc.content;

    if (!options.apply) {
      process.stdout.write(
        `${JSON.stringify(
          {
            dryRun: true,
            documentId: doc.id,
            path: doc.path,
            currentRevision: doc.revision,
            nextContentChars: content.length,
            nextContentSha256: sha256Hex(content),
            expectedRevision: options.expectedRevision ?? null,
            wouldBackupTo: resolve(options.backupDir),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    try {
      const updated = await memory.commit(
        {
          scope: doc.scope as "bot",
          botId: options.botId,
          path: doc.path,
          content,
          expectedRevision: options.expectedRevision,
        },
        {
          operationId: "admin-cli",
          traceId: "admin-cli",
          spaceId: actor.spaceId,
          userId: actor.userId,
          signal: new AbortController().signal,
        },
      );
      let backupPath: string | null = null;
      try {
        const backup = await backupSnapshot({
          prisma,
          actor,
          botId: options.botId,
          includeArchived: options.includeArchived,
          backupDir: options.backupDir,
          label: "post-memory",
        });
        backupPath = backup.file;
      } catch (err) {
        try {
          await memory.commit(
            {
              scope: doc.scope as "bot",
              botId: options.botId,
              path: doc.path,
              content: previousContent,
              expectedRevision: updated.revision,
            },
            {
              operationId: "admin-cli-revert",
              traceId: "admin-cli-revert",
              spaceId: actor.spaceId,
              userId: actor.userId,
              signal: new AbortController().signal,
            },
          );
        } catch {
          throw new Error(
            "Memory updated but backup failed and automatic revert also failed; check memory revision chain",
          );
        }
        throw err;
      }
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            backup: backupPath,
            documentId: updated.id,
            path: updated.path,
            revision: updated.revision,
          },
          null,
          2,
        )}\n`,
      );
    } catch (e) {
      if (e instanceof Error && e.message === MEMORY_REVISION_CONFLICT_ERROR) {
        throw new Error("Memory conflict: document was updated elsewhere (revision mismatch)");
      }
      throw e;
    }
  });
}

async function cmdUpdateSkill(
  prisma: PrismaLike,
  options: {
    owner: { id: string; email: string };
    spaceId?: string;
    skillId: string;
    skillFile: string;
    apply: boolean;
    backupDir: string;
  },
) {
  const raw = (await readFile(options.skillFile, "utf8")).replace(/^\uFEFF/, "");
  const spaceId = await resolveSpaceId(prisma, options.owner.id, options.spaceId);
  const actor = actorFor(options.owner, spaceId);
  const skills = createAgentSkillsService(prisma);

  await runAsTenant({ spaceId: actor.spaceId, userId: actor.userId }, async () => {
    const prior = await skills.get(actor, { skillId: options.skillId });
    if (!options.apply) {
      process.stdout.write(
        `${JSON.stringify(
          {
            dryRun: true,
            skillId: options.skillId,
            nextSkillFileChars: raw.length,
            nextSkillFileSha256: sha256Hex(raw),
            currentContentSha256: sha256Hex(prior.content),
            wouldBackupTo: resolve(options.backupDir),
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const backupDir = resolve(options.backupDir);
    await mkdir(backupDir, { recursive: true });
    const prePath = join(backupDir, `pre-skill-${options.skillId}-${Date.now()}.json`);
    await writePrivateJson(prePath, {
      version: SNAPSHOT_VERSION,
      label: "pre-skill",
      exportedAt: new Date().toISOString(),
      spaceId: actor.spaceId,
      userId: actor.userId,
      skill: prior,
    });
    await assertFileMode0600(prePath);

    try {
      await skills.update(actor, { skillId: options.skillId, content: raw });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Skill update failed";
      throw new Error(`Skill update failed: ${redactCliError(msg)}`);
    }

    let postPath: string | null = null;
    try {
      const after = await skills.get(actor, { skillId: options.skillId });
      const postFile = join(backupDir, `post-skill-${options.skillId}-${Date.now()}.json`);
      await writePrivateJson(postFile, {
        version: SNAPSHOT_VERSION,
        label: "post-skill",
        exportedAt: new Date().toISOString(),
        spaceId: actor.spaceId,
        userId: actor.userId,
        skill: after,
      });
      await assertFileMode0600(postFile);
      postPath = postFile;
    } catch (err) {
      try {
        await skills.update(actor, { skillId: options.skillId, content: prior.content });
      } catch {
        throw new Error(
          "Skill updated but post-commit backup failed and restore also failed; inspect agent_skills row",
        );
      }
      throw err;
    }

    process.stdout.write(`${JSON.stringify({ ok: true, backupPre: prePath, backupPost: postPath }, null, 2)}\n`);
  });
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "owner-email": { type: "string" },
    "owner-user-id": { type: "string" },
    "space-id": { type: "string" },
    "bot-id": { type: "string" },
    "name-contains": { type: "string" },
    "exact-name": { type: "string" },
    "all-spaces": { type: "boolean", default: false },
    out: { type: "string" },
    "instructions-file": { type: "string" },
    "expected-instructions-file": { type: "string" },
    "content-file": { type: "string" },
    "document-id": { type: "string" },
    path: { type: "string" },
    "expected-revision": { type: "string" },
    "skill-id": { type: "string" },
    "skill-file": { type: "string" },
    "backup-dir": { type: "string", default: DEFAULT_BACKUP_DIR },
    apply: { type: "boolean", default: false },
    "include-archived": { type: "boolean", default: false },
  },
});

const sub = positionals[0];
if (!sub) usage();

const { prisma, pool } = createDb(requireDbUrl(), {
  applicationName: "atlas-admin-bot-cli",
  keyProvider: contentKeyProviderFromEnv(),
});

try {
  const owner = await resolveOwner(prisma, values["owner-email"], values["owner-user-id"]);
  switch (sub) {
    case "list": {
      await cmdList(
        prisma,
        owner,
        values["space-id"],
        values["all-spaces"] ?? false,
        values["name-contains"],
        values["exact-name"],
        values["include-archived"] ?? false,
      );
      break;
    }
    case "find-bot": {
      await cmdFindBot(
        prisma,
        owner,
        values["exact-name"],
        values["name-contains"],
        values["include-archived"] ?? false,
      );
      break;
    }
    case "export": {
      if (!values["bot-id"] || !values.out) usage();
      await cmdExport(
        prisma,
        owner,
        values["space-id"],
        values["bot-id"],
        values.out,
        values["include-archived"] ?? false,
      );
      break;
    }
    case "update-instructions": {
      if (!values["bot-id"] || !values["instructions-file"]) usage();
      await cmdUpdateInstructions(prisma, {
        owner,
        spaceId: values["space-id"],
        botId: values["bot-id"],
        instructionsFile: values["instructions-file"],
        expectedInstructionsFile: values["expected-instructions-file"],
        apply: values.apply ?? false,
        backupDir: values["backup-dir"] ?? DEFAULT_BACKUP_DIR,
        includeArchived: values["include-archived"] ?? false,
      });
      break;
    }
    case "update-memory": {
      if (!values["bot-id"] || !values["content-file"]) usage();
      if (values["document-id"] && values.path) {
        throw new Error("Pass only one of --document-id or --path");
      }
      let expectedRevision: number | undefined;
      if (values["expected-revision"] !== undefined) {
        const n = Number(values["expected-revision"]);
        if (!Number.isInteger(n) || n < 0)
          throw new Error("--expected-revision must be a non-negative integer");
        expectedRevision = n;
      }
      await cmdUpdateMemory(prisma, {
        owner,
        spaceId: values["space-id"],
        botId: values["bot-id"],
        documentId: values["document-id"],
        path: values.path,
        contentFile: values["content-file"],
        expectedRevision,
        apply: values.apply ?? false,
        backupDir: values["backup-dir"] ?? DEFAULT_BACKUP_DIR,
        includeArchived: values["include-archived"] ?? false,
      });
      break;
    }
    case "update-skill": {
      if (!values["skill-id"] || !values["skill-file"]) usage();
      await cmdUpdateSkill(prisma, {
        owner,
        spaceId: values["space-id"],
        skillId: values["skill-id"],
        skillFile: values["skill-file"],
        apply: values.apply ?? false,
        backupDir: values["backup-dir"] ?? DEFAULT_BACKUP_DIR,
      });
      break;
    }
    default:
      usage();
  }
} catch (e) {
  let msg: string;
  if (e instanceof InstructionConflictError) {
    msg = "Instructions conflict: profile changed or expected value mismatch";
  } else if (e instanceof Error && e.message === MEMORY_REVISION_CONFLICT_ERROR) {
    msg = "Memory conflict: document was updated elsewhere (revision mismatch)";
  } else {
    msg = redactCliError(e instanceof Error ? e.message : "Unknown error");
  }
  process.stderr.write(`${msg}\n`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  await pool.end();
}
