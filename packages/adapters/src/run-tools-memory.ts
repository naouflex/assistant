import { MEMORY_REVISION_CONFLICT_ERROR } from "@atlas/adapter-kit";
import { HistoryReadInputSchema, HistorySearchInputSchema } from "@atlas/contracts";
import { readHistory, searchHistory } from "@atlas/db";
import { sharedMemorySaveError } from "./builtin-tools.js";
import { redactConnectorPayload } from "./connector-safety.js";
import { MAX_RECALLED_MEMORIES } from "./history-compaction.js";
import { appendMemoryFact } from "./memory-tools.js";
import type { RunContext } from "./run-context.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";

/** Cross-chat history requires a surviving direct human request in this app thread. */
export function historyMyChatsAllowed(
  run: { trigger: string; threadId: string },
  source: { role: string; threadId: string } | null,
  external: boolean,
): boolean {
  return (
    !external &&
    (run.trigger === "user" || run.trigger === "follow_up") &&
    source?.role === "user" &&
    source.threadId === run.threadId
  );
}

async function readHistoryTool(ctx: RunContext, call: ToolCall) {
  const { deps, run } = ctx;
  const { name, args } = call;
  const crossChat =
    name === "search_history"
      ? args.scope === "my_chats"
      : typeof args.threadId === "string" && args.threadId !== run.threadId;
  // Channel or webhook text claimed mid-turn revokes the grant for the rest of the run.
  const allowMyChats =
    crossChat && ctx.source.myChatsAllowed && !(await ctx.trust.receivedOutsideMessage());
  const scope = {
    spaceId: run.spaceId,
    userId: run.userId,
    threadId: run.threadId,
    botId: run.botId,
    channelId: ctx.source.channelId,
    searchBeforeSeq: ctx.source.historySearchBeforeSeq,
    allowMyChats,
    searchAt: run.createdAt,
  };
  const response =
    name === "search_history"
      ? await searchHistory(deps.prisma, scope, HistorySearchInputSchema.parse(args))
      : await readHistory(deps.prisma, scope, HistoryReadInputSchema.parse(args));
  const redacted = redactConnectorPayload(response, ctx.secrets);
  // Redaction can expand short synthetic credentials; never let Pi clip the JSON.
  if (Buffer.byteLength(JSON.stringify(redacted), "utf8") > 11_000) {
    return call.finish({
      untrusted: true,
      error:
        "Redacted history exceeds the response budget. Retry with limit 1 or a narrower linked run.",
    });
  }
  return call.finish(redacted);
}

/** Memory documents, semantic memory and thread history. */
export const memoryTools: ToolHandlers = {
  async remember(ctx, call) {
    const { deps, runId, bot, thread, context } = ctx;
    const { args } = call;
    const path = String(args.path ?? "").trim() || "MEMORY.md";
    // A fact is added to the document, never replaces it. A concurrent save
    // changes the revision, so re-read and append again.
    for (let attempt = 1; ; attempt += 1) {
      const snapshot = await deps.memory.read({ scope: "bot", botId: bot.id, path }, context);
      const existing = snapshot.documents[0];
      const content = appendMemoryFact(existing?.content ?? "", String(args.content ?? ""));
      if (content === (existing?.content ?? "")) return call.finish({ ok: true });
      try {
        await deps.memory.commit(
          {
            scope: "bot",
            botId: bot.id,
            path,
            content,
            expectedRevision: existing?.revision ?? 0,
            sourceRunId: runId,
            sourceThreadId: thread.id,
          },
          context,
        );
        return call.finish({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message !== MEMORY_REVISION_CONFLICT_ERROR || attempt >= 3) throw error;
      }
    }
  },
  async read_memory(ctx, call) {
    const { deps, bot, context } = ctx;
    const { args } = call;
    const path = String(args.path ?? "").trim();
    if (!path) return call.finish({ error: "path is required" });
    const scope = args.scope === "user" ? "user" : "bot";
    const snapshot = await deps.memory.read(
      { scope, path, ...(scope === "bot" ? { botId: bot.id } : {}) },
      context,
    );
    const document = snapshot.documents[0];
    if (!document) return call.finish({ error: "No note at that path." });
    return call.finish({
      path: document.path,
      scope,
      revision: document.revision,
      content: document.content,
    });
  },
  async save_shared_memory(ctx, call) {
    const { deps, runId, context } = ctx;
    const { args } = call;
    const invalid = sharedMemorySaveError(args);
    if (invalid) return call.finish({ error: invalid });
    const path = String(args.path ?? "").trim();
    const content = String(args.content ?? "");
    // The current note stays. The person accepts the full replacement later, and
    // that accept uses the revision recorded here so a newer edit is not overwritten.
    const snapshot = await deps.memory.read({ scope: "user", path }, context);
    const existing = snapshot.documents[0];
    if ((existing?.content ?? "") === content) {
      return call.finish({ ok: true, pending: true, path });
    }
    const duplicate = await deps.prisma.memoryProposal.findFirst({
      where: {
        spaceId: context.spaceId,
        userId: context.userId,
        scope: "user",
        botId: null,
        path,
        content,
        status: "pending",
      },
    });
    if (duplicate) return call.finish({ ok: true, pending: true, path });
    await deps.prisma.memoryProposal.create({
      data: {
        spaceId: context.spaceId,
        userId: context.userId,
        scope: "user",
        path,
        content,
        baseRevision: existing?.revision ?? 0,
        reason: "Proposed during a run.",
        evidence: { runIds: [runId], count: 1 },
        source: "bot",
        status: "pending",
      },
    });
    return call.finish({ ok: true, pending: true, path });
  },
  async recall_memory(ctx, call) {
    const { bot, thread, context } = ctx;
    const { args } = call;
    return ctx.memory.semantic!.recall(
      {
        query: String(args.query ?? ""),
        scope: ctx.memory.scope!,
        botId: bot.id,
        ...(thread.historyCompactedUpToSeq == null
          ? {}
          : { historyGeneration: thread.historyCompactionGeneration }),
        limit: MAX_RECALLED_MEMORIES,
      },
      context,
    );
  },
  search_history: readHistoryTool,
  read_history: readHistoryTool,
  async save_memory(ctx, call) {
    const { bot, context } = ctx;
    const { args } = call;
    return call.finish(
      await ctx.memory.semantic!.save(
        {
          content: String(args.content ?? ""),
          scope: ctx.memory.scope!,
          botId: bot.id,
          source: { kind: "durable" },
        },
        context,
      ),
    );
  },
  async forget_memory(ctx, call) {
    const { bot, context } = ctx;
    const { args } = call;
    if (!ctx.memory.semantic?.forget) {
      return call.finish({
        error: "This memory provider does not support forgetting individual facts.",
      });
    }
    return call.finish(
      await ctx.memory.semantic.forget(
        {
          id: String(args.id ?? ""),
          scope: ctx.memory.scope!,
          botId: bot.id,
          ...(typeof args.entity === "string" && args.entity.trim()
            ? { entity: args.entity.trim() }
            : {}),
          ...(typeof args.reason === "string" && args.reason.trim()
            ? { reason: args.reason.trim() }
            : {}),
        },
        context,
      ),
    );
  },
};
