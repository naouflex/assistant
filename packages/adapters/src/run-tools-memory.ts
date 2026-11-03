import { MEMORY_REVISION_CONFLICT_ERROR } from "@atlas/adapter-kit";
import {
  HistoryReadInputSchema,
  HistorySearchInputSchema,
  MEMORY_INDEX_PATH,
} from "@atlas/contracts";
import { readHistory, searchHistory } from "@atlas/db";
import { sharedMemorySaveError } from "./builtin-tools.js";
import { redactConnectorPayload } from "./connector-safety.js";
import { MAX_RECALLED_MEMORIES } from "./history-compaction.js";
import { appendJournalEntry, editMemory, journalPathForEntry } from "./memory-tools.js";
import { userTimeZone } from "./schedule-tools.js";
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
    const { deps, run, runId, bot, thread, context } = ctx;
    const { args } = call;
    if (args.journal === true) {
      const fact = String(args.content ?? "");
      const path = journalPathForEntry(fact, new Date(), await userTimeZone(deps.prisma, run.userId));
      for (let attempt = 1; ; attempt += 1) {
        const snapshot = await deps.memory.read({ scope: "bot", botId: bot.id, path }, context);
        const existing = snapshot.documents[0];
        const edit = appendJournalEntry(existing?.content ?? "", fact);
        if ("error" in edit) return call.finish(edit);
        if (edit.content === (existing?.content ?? "")) return call.finish({ ok: true, path });
        try {
          await deps.memory.commit(
            {
              scope: "bot",
              botId: bot.id,
              path,
              content: edit.content,
              expectedRevision: existing?.revision ?? 0,
              sourceRunId: runId,
              sourceThreadId: thread.id,
            },
            context,
          );
          return call.finish({ ok: true, path });
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (message !== MEMORY_REVISION_CONFLICT_ERROR || attempt >= 3) throw error;
        }
      }
    }
    // One document per bot keeps the size cap meaningful.
    const path = MEMORY_INDEX_PATH;
    // A concurrent save changes the revision, so re-read and apply the edit again.
    for (let attempt = 1; ; attempt += 1) {
      const snapshot = await deps.memory.read({ scope: "bot", botId: bot.id, path }, context);
      const existing = snapshot.documents[0];
      const edit = editMemory(
        existing?.content ?? "",
        String(args.content ?? ""),
        String(args.old_text ?? ""),
      );
      if ("error" in edit) return call.finish(edit);
      const { content } = edit;
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
  async save_shared_memory(ctx, call) {
    const { deps, run, context } = ctx;
    const { args } = call;
    const invalid = sharedMemorySaveError(args);
    if (invalid) return call.finish({ error: invalid });
    const path = String(args.path ?? "").trim();
    const content = String(args.content ?? "");
    // The current note stays until the owner accepts. The revision is the one just read.
    const snapshot = await deps.memory.read({ scope: "user", path }, context);
    const baseRevision = snapshot.documents[0]?.revision ?? 0;
    const duplicate = await deps.prisma.memoryProposal.findFirst({
      where: {
        spaceId: run.spaceId,
        userId: run.userId,
        scope: "user",
        path,
        status: "pending",
        content,
      },
      select: { id: true },
    });
    if (!duplicate) {
      await deps.prisma.memoryProposal.create({
        data: {
          spaceId: run.spaceId,
          userId: run.userId,
          scope: "user",
          path,
          content,
          baseRevision,
          reason: "Proposed from the chat.",
          evidence: {},
          source: "bot",
          status: "pending",
        },
      });
    }
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
  async read_memory(ctx, call) {
    const { deps, bot, context } = ctx;
    const path = String(call.args.path ?? "").trim();
    if (!path) return call.finish({ error: "path is required" });
    const scope = call.args.scope === "user" ? "user" : "bot";
    const snapshot = await deps.memory.read(
      scope === "user" ? { scope, path } : { scope, botId: bot.id, path },
      context,
    );
    const document = snapshot.documents[0];
    if (!document) return call.finish({ error: "No memory note at that path." });
    return call.finish({
      ok: true,
      scope,
      path: document.path,
      revision: document.revision,
      content: document.content,
    });
  },
  async search_memory(ctx, call) {
    const { deps, bot, context } = ctx;
    const query = String(call.args.query ?? "").trim();
    if (!query) return call.finish({ error: "query is required" });
    const limitRaw = Number(call.args.limit ?? 8);
    const limit = Number.isFinite(limitRaw) ? Math.min(20, Math.max(1, Math.floor(limitRaw))) : 8;
    const scopeArg = call.args.scope;
    const scopes: Array<"bot" | "user"> =
      scopeArg === "bot" ? ["bot"] : scopeArg === "user" ? ["user"] : ["bot", "user"];
    const hits: Array<{ scope: "bot" | "user"; path: string; snippet: string; score: number }> = [];
    for (const scope of scopes) {
      const results = await deps.memory.search(
        { query, scope, ...(scope === "bot" ? { botId: bot.id } : {}) },
        context,
      );
      for (const result of results) {
        hits.push({ scope, path: result.path, snippet: result.snippet, score: result.score });
      }
    }
    hits.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
    return call.finish({ ok: true, results: hits.slice(0, limit) });
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
