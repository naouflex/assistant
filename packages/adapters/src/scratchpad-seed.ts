import type { PrismaClient } from "@atlas/db";
import { addScratchpadItemFromTool, listScratchpadItems } from "./scratchpad-tools.js";

const MAX_SEEDS = 8;
const MIN_TITLE = 6;

const LIST_LINE = /^(?:\d+[.)]|[-*•])\s+(\S.{5,})$/;
const TASK_LINE =
  /\b(ship|fix|add|update|tune|build|write|remove|implement|test|deploy|check|create|make|finish|complete|send|review|set up|setup|corriger|ajouter|mettre à jour|construire|écrire|supprimer|implémenter|tester|déployer|vérifier|créer|faire|finir|envoyer|relire)\b/i;
const LOG_LINE =
  /\b(error|exception|traceback|stack|at \w+\.\w+|enoent|failed to|erreur|exception|échoué)\b/i;

/** A bullet reads like work to do, not a log line or a note. */
export function looksLikeTask(title: string): boolean {
  if (title.length > 160) return false;
  if (LOG_LINE.test(title) && !TASK_LINE.test(title)) return false;
  return TASK_LINE.test(title);
}

/** Titles from numbered or bulleted user messages that read like tasks. */
export function parseScratchpadSeeds(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const fromLines = trimmed
    .split(/\n+/)
    .map((line) => LIST_LINE.exec(line.trim())?.[1]?.trim())
    .filter((title): title is string => Boolean(title && title.length >= MIN_TITLE && looksLikeTask(title)));
  if (fromLines.length >= 2) return dedupe(fromLines);
  return [];
}

const PLAN_TITLE = /^(?:plan|plan[: ].*)$/i;

/** Mark open Plan items done when the turn that wrote them has finished. */
export async function closePlanScratchpadItems(
  deps: { prisma: PrismaClient },
  input: { spaceId: string; botId: string },
): Promise<number> {
  const open = await deps.prisma.scratchpadItem.findMany({
    where: { spaceId: input.spaceId, botId: input.botId, status: { in: ["open", "parked"] } },
    select: { id: true, title: true },
  });
  const ids = open.filter((item) => PLAN_TITLE.test(item.title.trim())).map((item) => item.id);
  if (ids.length === 0) return 0;
  const updated = await deps.prisma.scratchpadItem.updateMany({
    where: { id: { in: ids } },
    data: { status: "done" },
  });
  return updated.count;
}

function dedupe(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of titles) {
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title.slice(0, 200));
    if (out.length >= MAX_SEEDS) break;
  }
  return out;
}

export async function seedScratchpadFromUserPrompt(
  deps: { prisma: PrismaClient },
  input: { spaceId: string; botId: string; userId: string; prompt: string },
): Promise<number> {
  const seeds = parseScratchpadSeeds(input.prompt);
  if (seeds.length < 2) return 0;
  const existing = await listScratchpadItems(deps, {
    spaceId: input.spaceId,
    botId: input.botId,
    includeDone: false,
  });
  const open = new Set(existing.map((item) => item.title.trim().toLowerCase()));
  let added = 0;
  for (const title of seeds) {
    if (open.has(title.toLowerCase())) continue;
    const result = await addScratchpadItemFromTool(deps, {
      spaceId: input.spaceId,
      botId: input.botId,
      userId: input.userId,
      title,
      status: "open",
    });
    if ("item" in result) {
      open.add(title.toLowerCase());
      added += 1;
    }
  }
  return added;
}
