import type { PrismaClient } from "@atlas/db";
import { addScratchpadItemFromTool, listScratchpadItems } from "./scratchpad-tools.js";

const MAX_SEEDS = 8;
const MIN_TITLE = 6;

const LIST_LINE = /^(?:\d+[.)]|[-*•])\s+(\S.{5,})$/;

/** Titles from numbered or bulleted user messages. */
export function parseScratchpadSeeds(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const fromLines = trimmed
    .split(/\n+/)
    .map((line) => LIST_LINE.exec(line.trim())?.[1]?.trim())
    .filter((title): title is string => Boolean(title && title.length >= MIN_TITLE));
  if (fromLines.length >= 2) return dedupe(fromLines);
  return [];
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
