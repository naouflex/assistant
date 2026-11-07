import { MEMORY_REVISION_CONFLICT_ERROR, memoryDreamJob } from "@atlas/adapter-kit";
import type { DreamEdit } from "@atlas/adapters";
import {
  applyDreamEdits,
  buildAgentMemoryPrompt,
  isScratchpadStatus,
  listScratchpadItems,
  mapScratchpadItem,
  parseDreamEdits,
  readAgentMemory,
  UNDO_WINDOW_MS,
} from "@atlas/adapters";
import type { MemoryProposal } from "@atlas/contracts";
import { isDeletableMemoryDocument } from "@atlas/contracts";
import { findSpaceMemoryConfig, IsolationError } from "@atlas/db";
import { ORPCError } from "@orpc/server";
import {
  disconnectMemoryProvider,
  persistMemoryProviderConfig,
  serializeSpaceMemoryConfig,
  updateMemoryProviderDefaultScope,
} from "../memory-provider-config.js";
import type { RouterContext } from "./context.js";

export function memoryRoutes(ctx: RouterContext) {
  const { deps, repos, taughtSkills, agentSkills, authed } = ctx;
  return {
    memory: {
      list: authed.memory.list.handler(async ({ context, input }) => {
        const docs = await deps.prisma.memoryDocument.findMany({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            ...(input.botId ? { botId: input.botId } : {}),
            ...(input.scope ? { scope: input.scope } : {}),
          },
        });
        return docs.map((doc) => ({
          id: doc.id,
          scope: doc.scope as "bot" | "user",
          botId: doc.botId,
          path: doc.path,
          content: doc.content,
          revision: doc.revision,
          updatedAt: doc.updatedAt.toISOString(),
        }));
      }),
      budget: authed.memory.budget.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        // Read through the store a run uses, so the numbers match what the bot receives.
        const documents = await readAgentMemory(deps.memory, input.botId, {
          operationId: "mem",
          traceId: "mem",
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
          botId: input.botId,
          signal: context.signal ?? new AbortController().signal,
        });
        return buildAgentMemoryPrompt(documents).plan;
      }),
      update: authed.memory.update.handler(async ({ context, input }) => {
        const doc = await deps.prisma.memoryDocument.findFirst({
          where: {
            id: input.documentId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
        });
        if (!doc) throw new IsolationError();
        const updated = await deps.memory
          .commit(
            {
              scope: doc.scope as "bot" | "user",
              botId: doc.botId ?? undefined,
              path: doc.path,
              content: input.content,
              expectedRevision: input.expectedRevision,
            },
            {
              operationId: "mem",
              traceId: "mem",
              spaceId: context.actor.spaceId,
              userId: context.actor.userId,
              signal: new AbortController().signal,
            },
          )
          .catch((error: unknown) => {
            if (error instanceof Error && error.message === MEMORY_REVISION_CONFLICT_ERROR) {
              throw new ORPCError("CONFLICT", { message: error.message });
            }
            throw error;
          });
        return {
          id: updated.id,
          scope: doc.scope as "bot" | "user",
          botId: doc.botId,
          path: updated.path,
          content: updated.content,
          revision: updated.revision,
          updatedAt: new Date().toISOString(),
        };
      }),
      remove: authed.memory.remove.handler(async ({ context, input }) => {
        const doc = await deps.prisma.memoryDocument.findFirst({
          where: {
            id: input.documentId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
        });
        if (!doc) throw new IsolationError();
        if (!isDeletableMemoryDocument(doc.path)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `${doc.path} cannot be deleted; edit its content instead.`,
          });
        }
        await deps.memory.remove(
          {
            id: doc.id,
            scope: doc.scope as "bot" | "user",
            botId: doc.botId ?? undefined,
            path: doc.path,
          },
          {
            operationId: "mem",
            traceId: "mem",
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            signal: new AbortController().signal,
          },
        );
        return { ok: true as const };
      }),
      exportMarkdown: authed.memory.exportMarkdown.handler(async ({ context, input }) => {
        const docs = await deps.prisma.memoryDocument.findMany({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            ...(input.botId ? { botId: input.botId } : {}),
          },
        });
        return docs.map((d) => `# ${d.path}\n\n${d.content}`).join("\n\n");
      }),
      providerConfig: authed.memory.providerConfig.handler(async ({ context }) => {
        const config = await findSpaceMemoryConfig(deps.prisma, context.actor.spaceId);
        return config ? serializeSpaceMemoryConfig(config) : null;
      }),
      connectProvider: authed.memory.connectProvider.handler(async ({ context, input }) =>
        persistMemoryProviderConfig(deps, context.actor, input),
      ),
      setDefaultScope: authed.memory.setDefaultScope.handler(async ({ context, input }) =>
        updateMemoryProviderDefaultScope(deps, context.actor, input.defaultMemoryScope),
      ),
      disconnectProvider: authed.memory.disconnectProvider.handler(async ({ context }) =>
        disconnectMemoryProvider(deps, context.actor),
      ),
      proposals: authed.memory.proposals.handler(async ({ context, input }) => {
        const botId = await memoryBotId(repos, context.actor, input);
        const applied = input.status === "applied";
        const rows = await deps.prisma.memoryProposal.findMany({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            scope: input.scope,
            botId,
            status: applied ? "applied" : "pending",
            ...(applied ? { updatedAt: { gte: new Date(Date.now() - UNDO_WINDOW_MS) } } : {}),
          },
          orderBy: { createdAt: "desc" },
          ...(applied ? { take: 10 } : {}),
        });
        return rows.map(proposalView);
      }),
      dream: authed.memory.dream.handler(async ({ context, input }) => {
        const botId = await memoryBotId(repos, context.actor, input);
        const row = await deps.prisma.memoryDream.findFirst({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            botId,
          },
          orderBy: { createdAt: "desc" },
        });
        return row ? dreamView(row, input.scope) : null;
      }),
      startDream: authed.memory.startDream.handler(async ({ context, input }) => {
        const botId = await memoryBotId(repos, context.actor, input);
        const where = {
          spaceId: context.actor.spaceId,
          userId: context.actor.userId,
          botId,
        };
        const active = await deps.prisma.memoryDream.findFirst({
          where: { ...where, status: { in: ["queued", "running"] } },
          orderBy: { createdAt: "desc" },
        });
        if (active && Date.now() - active.updatedAt.getTime() < DREAM_STALE_MS) {
          return dreamView(active, input.scope);
        }
        if (active) {
          await deps.prisma.memoryDream.update({
            where: { id: active.id },
            data: {
              status: "failed",
              error: "Could not review recent runs.",
            },
          });
        }
        const created = await deps.prisma.memoryDream.create({
          data: { ...where, status: "queued" },
        });
        try {
          await deps.jobs.enqueue(memoryDreamJob(created.id));
        } catch (error) {
          await deps.prisma.memoryDream.update({
            where: { id: created.id },
            data: {
              status: "failed",
              error: "Could not review recent runs.",
            },
          });
          throw error;
        }
        return dreamView(created, input.scope);
      }),
      acceptProposal: authed.memory.acceptProposal.handler(async ({ context, input }) => {
        const proposal = await deps.prisma.memoryProposal.findFirst({
          where: {
            id: input.proposalId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            status: "pending",
          },
        });
        if (!proposal) throw new IsolationError();
        const scope = proposal.scope as "bot" | "user";
        const commit = (content: string, expectedRevision: number) =>
          deps.memory.commit(
            {
              scope,
              botId: proposal.botId ?? undefined,
              path: proposal.path,
              content,
              expectedRevision,
            },
            memoryContext(context.actor),
          );
        const conflict = (error: unknown) =>
          error instanceof Error && error.message === MEMORY_REVISION_CONFLICT_ERROR;
        let updated: Awaited<ReturnType<typeof commit>>;
        try {
          updated = await commit(proposal.content, proposal.baseRevision);
        } catch (error) {
          if (!conflict(error)) throw error;
          // The note changed since the review read it. Line edits still apply when
          // their target lines are there, so the card does not go stale.
          const edits = proposalEdits(proposal.evidence);
          const live = await deps.prisma.memoryDocument.findFirst({
            where: {
              spaceId: context.actor.spaceId,
              userId: context.actor.userId,
              scope,
              botId: proposal.botId,
              path: proposal.path,
            },
          });
          const replayed = edits ? applyDreamEdits(live?.content ?? "", edits) : null;
          if (!replayed?.ok) {
            throw new ORPCError("CONFLICT", { message: MEMORY_REVISION_CONFLICT_ERROR });
          }
          updated = await commit(replayed.content, live?.revision ?? 0).catch((retry: unknown) => {
            if (conflict(retry)) {
              throw new ORPCError("CONFLICT", { message: MEMORY_REVISION_CONFLICT_ERROR });
            }
            throw retry;
          });
        }
        await deps.prisma.memoryProposal.update({
          where: { id: proposal.id },
          data: { status: "accepted" },
        });
        return {
          id: updated.id,
          scope,
          botId: proposal.botId,
          path: updated.path,
          content: updated.content,
          revision: updated.revision,
          updatedAt: new Date().toISOString(),
        };
      }),
      rejectProposal: authed.memory.rejectProposal.handler(async ({ context, input }) => {
        const proposal = await deps.prisma.memoryProposal.findFirst({
          where: {
            id: input.proposalId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            status: "pending",
          },
        });
        if (!proposal) throw new IsolationError();
        await deps.prisma.memoryProposal.update({
          where: { id: proposal.id },
          data: { status: input.reason === "dismiss" ? "dismissed" : "rejected" },
        });
        return { ok: true as const };
      }),
      undoProposal: authed.memory.undoProposal.handler(async ({ context, input }) => {
        const proposal = await deps.prisma.memoryProposal.findFirst({
          where: {
            id: input.proposalId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            status: "applied",
          },
        });
        if (!proposal) throw new IsolationError();
        const evidence = (proposal.evidence ?? {}) as {
          appliedRevision?: unknown;
          previousRevision?: unknown;
        };
        const scope = proposal.scope as "bot" | "user";
        const doc = await deps.prisma.memoryDocument.findFirst({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            scope,
            botId: proposal.botId,
            path: proposal.path,
          },
        });
        const previous =
          doc && typeof evidence.previousRevision === "number"
            ? await deps.prisma.memoryRevision.findFirst({
                where: { documentId: doc.id, revision: evidence.previousRevision },
              })
            : null;
        if (!doc || !previous || doc.revision !== evidence.appliedRevision) {
          // Something wrote the note after the update; restoring would lose that.
          throw new ORPCError("CONFLICT", { message: MEMORY_REVISION_CONFLICT_ERROR });
        }
        const restored = await deps.memory
          .commit(
            {
              scope,
              botId: proposal.botId ?? undefined,
              path: proposal.path,
              content: previous.content,
              expectedRevision: doc.revision,
            },
            memoryContext(context.actor),
          )
          .catch((error: unknown) => {
            if (error instanceof Error && error.message === MEMORY_REVISION_CONFLICT_ERROR) {
              throw new ORPCError("CONFLICT", { message: error.message });
            }
            throw error;
          });
        await deps.prisma.memoryProposal.update({
          where: { id: proposal.id },
          data: { status: "undone" },
        });
        return {
          id: restored.id,
          scope,
          botId: proposal.botId,
          path: restored.path,
          content: restored.content,
          revision: restored.revision,
          updatedAt: new Date().toISOString(),
        };
      }),
    },
    scratchpad: {
      list: authed.scratchpad.list.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return listScratchpadItems(
          { prisma: deps.prisma },
          {
            spaceId: context.actor.spaceId,
            botId: input.botId,
            status: input.status,
            includeDone: input.includeDone ?? false,
          },
        );
      }),
      create: authed.scratchpad.create.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        const row = await deps.prisma.scratchpadItem.create({
          data: {
            spaceId: context.actor.spaceId,
            botId: input.botId,
            userId: context.actor.userId,
            title: input.title.trim(),
            status: input.status,
            notes: input.notes.trim(),
          },
        });
        return mapScratchpadItem(row);
      }),
      update: authed.scratchpad.update.handler(async ({ context, input }) => {
        const existing = await deps.prisma.scratchpadItem.findFirst({
          where: {
            id: input.itemId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
        });
        if (!existing) throw new IsolationError();
        if (input.status !== undefined && !isScratchpadStatus(input.status)) {
          throw new ORPCError("BAD_REQUEST", { message: "Invalid scratchpad status." });
        }
        const row = await deps.prisma.scratchpadItem.update({
          where: { id: existing.id },
          data: {
            ...(input.title !== undefined ? { title: input.title.trim() } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
          },
        });
        return mapScratchpadItem(row);
      }),
      remove: authed.scratchpad.remove.handler(async ({ context, input }) => {
        const existing = await deps.prisma.scratchpadItem.findFirst({
          where: {
            id: input.itemId,
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
          },
        });
        if (!existing) throw new IsolationError();
        await deps.prisma.scratchpadItem.delete({ where: { id: existing.id } });
        return { ok: true as const };
      }),
    },
    skills: {
      list: authed.skills.list.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return taughtSkills.list(context.actor, input.botId);
      }),
      get: authed.skills.get.handler(async ({ context, input }) =>
        taughtSkills.get(context.actor, input.skillId),
      ),
      start: authed.skills.start.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        return taughtSkills.start(context.actor, input.botId, input.goal);
      }),
      appendEvent: authed.skills.appendEvent.handler(async ({ context, input }) =>
        taughtSkills.appendEvent(context.actor, input.skillId, input.event),
      ),
      snapshot: authed.skills.snapshot.handler(async ({ context, input }) =>
        taughtSkills.snapshot(context.actor, input.skillId),
      ),
      stop: authed.skills.stop.handler(async ({ context, input }) =>
        taughtSkills.stop(context.actor, input.skillId),
      ),
      updateDraft: authed.skills.updateDraft.handler(async ({ context, input }) =>
        taughtSkills.updateDraft(context.actor, input.skillId, {
          name: input.name,
          playbook: input.playbook,
        }),
      ),
      save: authed.skills.save.handler(async ({ context, input }) =>
        taughtSkills.save(context.actor, input.skillId, input.name),
      ),
      testRun: authed.skills.testRun.handler(async ({ context, input }) =>
        taughtSkills.testRun(context.actor, input.skillId, input.prompt),
      ),
      remove: authed.skills.remove.handler(async ({ context, input }) =>
        taughtSkills.remove(context.actor, input.skillId),
      ),
    },
    agentSkills: {
      list: authed.agentSkills.list.handler(async ({ context }) => agentSkills.list(context.actor)),
      get: authed.agentSkills.get.handler(async ({ context, input }) =>
        agentSkills.get(context.actor, input),
      ),
      create: authed.agentSkills.create.handler(async ({ context, input }) =>
        agentSkills.create(context.actor, input),
      ),
      update: authed.agentSkills.update.handler(async ({ context, input }) =>
        agentSkills.update(context.actor, input),
      ),
      remove: authed.agentSkills.remove.handler(async ({ context, input }) =>
        agentSkills.remove(context.actor, input.skillId),
      ),
    },
  };
}

const DREAM_STALE_MS = 10 * 60 * 1000;

type MemoryActor = { spaceId: string; userId: string };

function memoryContext(actor: MemoryActor) {
  return {
    operationId: "mem",
    traceId: "mem",
    spaceId: actor.spaceId,
    userId: actor.userId,
    signal: new AbortController().signal,
  };
}

async function memoryBotId<Actor extends MemoryActor>(
  repos: { getBot: (actor: Actor, botId: string) => Promise<unknown> },
  actor: Actor,
  input: { scope: "bot" | "user"; botId?: string },
): Promise<string | null> {
  if (input.scope === "bot") {
    if (!input.botId) throw new ORPCError("BAD_REQUEST", { message: "botId is required." });
    await repos.getBot(actor, input.botId);
    return input.botId;
  }
  if (input.botId)
    throw new ORPCError("BAD_REQUEST", {
      message: "Shared memory has no bot.",
    });
  return null;
}

function proposalEdits(evidence: unknown): DreamEdit[] | null {
  const edits = (evidence as { edits?: unknown } | null)?.edits;
  return edits === undefined ? null : parseDreamEdits(edits);
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((line): line is string => typeof line === "string").slice(0, 40)
    : undefined;
}

function proposalView(row: {
  id: string;
  scope: string;
  botId: string | null;
  path: string;
  content: string;
  baseRevision: number;
  reason: string;
  source: string;
  status: string;
  evidence?: unknown;
  createdAt: Date;
  updatedAt?: Date;
}) {
  const evidence = (row.evidence ?? {}) as { added?: unknown; removed?: unknown; rail?: unknown };
  const added = stringList(evidence.added);
  const removed = stringList(evidence.removed);
  return {
    ...(added ? { added } : {}),
    ...(removed ? { removed } : {}),
    askReason: typeof evidence.rail === "string" && evidence.rail !== "auto" ? evidence.rail : null,
    ...(row.updatedAt ? { updatedAt: row.updatedAt.toISOString() } : {}),
    id: row.id,
    scope: row.scope as "bot" | "user",
    botId: row.botId,
    path: row.path,
    content: row.content,
    baseRevision: row.baseRevision,
    reason: row.reason,
    source: row.source as "dream" | "bot",
    status: row.status as MemoryProposal["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

function dreamView(
  row: {
    id: string;
    botId: string | null;
    status: string;
    error: string | null;
    createdAt: Date;
  },
  scope: "bot" | "user",
) {
  return {
    id: row.id,
    scope,
    botId: row.botId,
    status: row.status as "queued" | "running" | "ready" | "failed",
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}
