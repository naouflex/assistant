import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { bootstrapUserSpace, createDb, runAsSystem, runAsTenant } from "@atlas/db";
import { initialBotMemory } from "@atlas/contracts";
import { expect, it } from "vitest";

const run = promisify(execFile);
const testDatabase = process.env.VERIFY_DATABASE === "1" ? process.env.DATABASE_URL : undefined;

async function runCli(args: string[], env: NodeJS.ProcessEnv) {
  return run(
    "pnpm",
    ["--filter", "@atlas/api", "exec", "tsx", "src/cli/admin-bot.ts", ...args],
    { env: { ...process.env, ...env } },
  );
}

it.skipIf(!testDatabase)(
  "admin-bot CLI: owner user id, find-bot, isolation, dry-run, backups 0600, stale guards, skill update",
  async () => {
    if (!testDatabase) throw new Error("DATABASE_URL is required");
    const { prisma, pool } = createDb(testDatabase);
    const suffix = `${process.pid}-${Date.now()}`;
    const ownerEmail = `abot-owner-${suffix}@atlas.test`;
    const strangerEmail = `abot-stranger-${suffix}@atlas.test`;
    const backupRoot = await mkdtemp(join(tmpdir(), "admin-bot-backup-"));
    const userId = randomUUID();
    const strangerId = randomUUID();
    let spaceIdFixture = "";
    const cliEnv = {
      DATABASE_URL: testDatabase,
      DATABASE_MIGRATION_URL: undefined,
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "a".repeat(64),
      CONTENT_ENCRYPTION: process.env.CONTENT_ENCRYPTION ?? "on",
    };

    try {
      await runAsSystem("admin-bot test fixture", async () => {
        const owner = await prisma.user.create({
          data: {
            id: userId,
            name: "Owner",
            email: ownerEmail,
            emailVerified: true,
          },
        });
        const { spaceId } = await bootstrapUserSpace(prisma, owner, {
          signupsEnabled: "true",
          signupAllowlist: "",
        });
        spaceIdFixture = spaceId;
        const space = await prisma.space.findUniqueOrThrow({ where: { id: spaceId } });

        const computerId = `comp-${suffix}`;
        await prisma.computer.create({
          data: {
            id: computerId,
            spaceId,
            userId: owner.id,
            scope: "team",
            scopeKey: `team-${suffix}`,
            homeKey: `home-${suffix}`,
            kind: "docker",
          },
        });

        const botA = `bot-a-${suffix}`;
        const botB = `bot-b-${suffix}`;
        const threadA = `th-a-${suffix}`;
        const threadB = `th-b-${suffix}`;
        await prisma.bot.create({
          data: {
            id: botA,
            spaceId,
            userId: owner.id,
            name: "TwinName",
            color: "#3EC5A8",
            instructions: "first instructions",
            computerId,
          },
        });
        await prisma.thread.create({
          data: { id: threadA, spaceId, userId: owner.id, botId: botA },
        });
        await prisma.memoryDocument.create({
          data: {
            spaceId,
            userId: owner.id,
            botId: botA,
            scope: "bot",
            path: "MEMORY.md",
            content: `${initialBotMemory("TwinName")}\nFact A\n`,
          },
        });
        await prisma.memoryDocument.create({
          data: {
            spaceId,
            userId: owner.id,
            botId: botA,
            scope: "bot",
            path: "notes/extra.md",
            content: "# Notes\n\nExtra doc\n",
          },
        });

        await prisma.bot.create({
          data: {
            id: botB,
            spaceId,
            userId: owner.id,
            name: "TwinName",
            color: "#6A6BF5",
            instructions: "second",
            computerId,
          },
        });
        await prisma.thread.create({
          data: { id: threadB, spaceId, userId: owner.id, botId: botB },
        });
        await prisma.memoryDocument.create({
          data: {
            spaceId,
            userId: owner.id,
            botId: botB,
            scope: "bot",
            path: "MEMORY.md",
            content: initialBotMemory("TwinName"),
          },
        });

        await prisma.agentSkill.create({
          data: {
            id: `skill-${suffix}`,
            spaceId,
            userId: owner.id,
            name: "Fixture Skill",
            description: "Fixture",
            content: "---\nname: Fixture Skill\ndescription: Fixture\n---\nBody one\n",
            source: "user",
            allSpaces: true,
          },
        });

        const stranger = await prisma.user.create({
          data: {
            id: strangerId,
            name: "Stranger",
            email: strangerEmail,
            emailVerified: true,
          },
        });
        await prisma.member.create({
          data: {
            id: `mem-${suffix}`,
            organizationId: space.organizationId,
            userId: stranger.id,
            role: "member",
            createdAt: new Date(),
          },
        });
        const strangerSpaceId = `sp-str-${suffix}`;
        await prisma.space.create({
          data: {
            id: strangerSpaceId,
            organizationId: space.organizationId,
            name: "Stranger space",
            createdByUserId: stranger.id,
          },
        });
        await prisma.spaceMember.create({
          data: {
            id: `spm-str-${suffix}`,
            spaceId: strangerSpaceId,
            organizationId: space.organizationId,
            userId: stranger.id,
            role: "owner",
            createdAt: new Date(),
          },
        });
      });

      const { stdout: listOut } = await runCli(
        ["list", "--owner-user-id", userId, "--space-id", spaceIdFixture],
        cliEnv,
      );
      const list = JSON.parse(listOut) as { count: number };
      expect(list.count).toBeGreaterThanOrEqual(2);

      await expect(
        runCli(
          ["list", "--owner-user-id", userId, "--space-id", spaceIdFixture, "--exact-name", "TwinName"],
          cliEnv,
        ),
      ).rejects.toThrow();

      const { stdout: findOut } = await runCli(
        ["find-bot", "--owner-user-id", userId, "--exact-name", "TwinName"],
        cliEnv,
      );
      const found = JSON.parse(findOut) as { count: number };
      expect(found.count).toBe(2);

      await expect(
        runCli(
          [
            "export",
            "--owner-user-id",
            strangerId,
            "--space-id",
            spaceIdFixture,
            "--bot-id",
            `bot-a-${suffix}`,
            "--out",
            join(backupRoot, "x.json"),
          ],
          cliEnv,
        ),
      ).rejects.toThrow();

      const exportPath = join(backupRoot, "export.json");
      await runCli(
        [
          "export",
          "--owner-user-id",
          userId,
          "--space-id",
          spaceIdFixture,
          "--bot-id",
          `bot-a-${suffix}`,
          "--out",
          exportPath,
        ],
        cliEnv,
      );
      expect((await stat(exportPath)).mode & 0o777).toBe(0o600);
      const exported = JSON.parse(await readFile(exportPath, "utf8")) as {
        version: number;
        bot: { instructions: string };
        memoryDocuments: Array<{ path: string; revision: number; content: string }>;
        knowledge: { agentSkillsInSpace: Array<{ name: string }> };
      };
      expect(exported.version).toBe(2);
      expect(exported.bot.instructions).toContain("first");
      expect(exported.knowledge.agentSkillsInSpace.some((s) => s.name === "Fixture Skill")).toBe(
        true,
      );

      const instrBefore = exported.bot.instructions;
      const instrFile = join(backupRoot, "next.txt");
      await writeFile(instrFile, `${instrBefore}\nCLI line\n`, { encoding: "utf8" });

      const { stdout: dryInstr } = await runCli(
        [
          "update-instructions",
          "--owner-user-id",
          userId,
          "--space-id",
          spaceIdFixture,
          "--bot-id",
          `bot-a-${suffix}`,
          "--instructions-file",
          instrFile,
        ],
        cliEnv,
      );
      expect(JSON.parse(dryInstr).dryRun).toBe(true);
      const botAfterDry = await runAsTenant(
        { spaceId: spaceIdFixture, userId },
        () => prisma.bot.findUniqueOrThrow({ where: { id: `bot-a-${suffix}` } }),
      );
      expect(botAfterDry.instructions).toBe(instrBefore);

      const wrongExpected = join(backupRoot, "wrong-expected.txt");
      await writeFile(wrongExpected, "not the live instructions", { encoding: "utf8" });
      await expect(
        runCli(
          [
            "update-instructions",
            "--apply",
            "--owner-user-id",
            userId,
            "--space-id",
            spaceIdFixture,
            "--bot-id",
            `bot-a-${suffix}`,
            "--instructions-file",
            instrFile,
            "--expected-instructions-file",
            wrongExpected,
            "--backup-dir",
            backupRoot,
          ],
          cliEnv,
        ),
      ).rejects.toThrow();
      const botAfterConflict = await runAsTenant(
        { spaceId: spaceIdFixture, userId },
        () => prisma.bot.findUniqueOrThrow({ where: { id: `bot-a-${suffix}` } }),
      );
      expect(botAfterConflict.instructions).toBe(instrBefore);

      const currentInstrPath = join(backupRoot, "current-instr.txt");
      await writeFile(currentInstrPath, instrBefore, { encoding: "utf8" });
      await runCli(
        [
          "update-instructions",
          "--apply",
          "--owner-user-id",
          userId,
          "--space-id",
          spaceIdFixture,
          "--bot-id",
          `bot-a-${suffix}`,
          "--instructions-file",
          instrFile,
          "--expected-instructions-file",
          currentInstrPath,
          "--backup-dir",
          backupRoot,
        ],
        cliEnv,
      );

      const files = await readdir(backupRoot);
      for (const name of files.filter((f) => f.startsWith("post-instructions-"))) {
        expect((await stat(join(backupRoot, name))).mode & 0o777).toBe(0o600);
      }
      for (const name of files.filter((f) => f.startsWith("pre-skill-") || f.startsWith("post-skill-"))) {
        expect((await stat(join(backupRoot, name))).mode & 0o777).toBe(0o600);
      }

      const memDoc = exported.memoryDocuments.find((d) => d.path === "MEMORY.md");
      expect(memDoc).toBeDefined();
      const memFile = join(backupRoot, "mem.md");
      await writeFile(memFile, `${memDoc!.content.replace(/Fact A\n$/, "")}Fact B\n`, {
        encoding: "utf8",
      });

      const { stdout: dryMem } = await runCli(
        [
          "update-memory",
          "--owner-user-id",
          userId,
          "--space-id",
          spaceIdFixture,
          "--bot-id",
          `bot-a-${suffix}`,
          "--path",
          "MEMORY.md",
          "--content-file",
          memFile,
          "--expected-revision",
          String(memDoc!.revision),
        ],
        cliEnv,
      );
      expect(JSON.parse(dryMem).dryRun).toBe(true);

      const notesBefore = await runAsTenant(
        { spaceId: spaceIdFixture, userId },
        () =>
          prisma.memoryDocument.findFirstOrThrow({
            where: {
              spaceId: spaceIdFixture,
              userId,
              botId: `bot-a-${suffix}`,
              path: "notes/extra.md",
            },
          }),
      );
      const revBeforeMem = await runAsTenant(
        { spaceId: spaceIdFixture, userId },
        async () =>
          (
            await prisma.memoryDocument.findFirstOrThrow({
              where: {
                spaceId: spaceIdFixture,
                userId,
                botId: `bot-a-${suffix}`,
                path: "MEMORY.md",
              },
            })
          ).revision,
      );

      await runCli(
        [
          "update-memory",
          "--apply",
          "--owner-user-id",
          userId,
          "--space-id",
          spaceIdFixture,
          "--bot-id",
          `bot-a-${suffix}`,
          "--path",
          "MEMORY.md",
          "--content-file",
          memFile,
          "--expected-revision",
          String(memDoc!.revision),
          "--backup-dir",
          backupRoot,
        ],
        cliEnv,
      );

      const revAfterMem = await runAsTenant(
        { spaceId: spaceIdFixture, userId },
        async () =>
          (
            await prisma.memoryDocument.findFirstOrThrow({
              where: {
                spaceId: spaceIdFixture,
                userId,
                botId: `bot-a-${suffix}`,
                path: "MEMORY.md",
              },
            })
          ).revision,
      );
      expect(revAfterMem).toBe(revBeforeMem + 1);

      const notesAfter = await runAsTenant(
        { spaceId: spaceIdFixture, userId },
        () =>
          prisma.memoryDocument.findFirstOrThrow({
            where: {
              spaceId: spaceIdFixture,
              userId,
              botId: `bot-a-${suffix}`,
              path: "notes/extra.md",
            },
          }),
      );
      expect(notesAfter.content).toBe(notesBefore.content);
      expect(notesAfter.revision).toBe(notesBefore.revision);

      await expect(
        runCli(
          [
            "update-memory",
            "--apply",
            "--owner-user-id",
            userId,
            "--space-id",
            spaceIdFixture,
            "--bot-id",
            `bot-a-${suffix}`,
            "--path",
            "MEMORY.md",
            "--content-file",
            memFile,
            "--expected-revision",
            "0",
            "--backup-dir",
            backupRoot,
          ],
          cliEnv,
        ),
      ).rejects.toThrow();

      const skillPath = join(backupRoot, "skill.md");
      await writeFile(
        skillPath,
        "---\nname: Fixture Skill\ndescription: Fixture\n---\nBody two\n",
        { encoding: "utf8" },
      );
      await runCli(
        [
          "update-skill",
          "--apply",
          "--owner-user-id",
          userId,
          "--space-id",
          spaceIdFixture,
          "--skill-id",
          `skill-${suffix}`,
          "--skill-file",
          skillPath,
          "--backup-dir",
          backupRoot,
        ],
        cliEnv,
      );
      const skillRow = await runAsTenant(
        { spaceId: spaceIdFixture, userId },
        () => prisma.agentSkill.findUniqueOrThrow({ where: { id: `skill-${suffix}` } }),
      );
      expect(skillRow.content).toContain("Body two");

      const export2 = join(backupRoot, "after.json");
      await runCli(
        [
          "export",
          "--owner-user-id",
          userId,
          "--space-id",
          spaceIdFixture,
          "--bot-id",
          `bot-a-${suffix}`,
          "--out",
          export2,
        ],
        cliEnv,
      );
      const after = JSON.parse(await readFile(export2, "utf8")) as {
        memoryDocuments: Array<{ content: string }>;
        bot: { instructions: string };
      };
      expect(after.memoryDocuments.some((d) => d.content.includes("Fact B"))).toBe(true);
      expect(after.bot.instructions).toContain("CLI line");
    } finally {
      await runAsSystem("admin-bot test cleanup", async () => {
        if (spaceIdFixture) {
          await prisma.organization.deleteMany({ where: { id: spaceIdFixture } });
        }
        await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
      });
      await prisma.$disconnect();
      await pool.end();
      await rm(backupRoot, { recursive: true, force: true });
    }
  },
  180_000,
);
