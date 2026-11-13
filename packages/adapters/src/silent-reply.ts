import type { MessageBlock } from "@atlas/contracts";

/** Exact token a silent run must emit as its entire final assistant reply. */
export const NO_RESPONSE = "NO_RESPONSE";

function textBlocksOf(
  blocks: readonly MessageBlock[],
): Array<Extract<MessageBlock, { kind: "text" }>> {
  return blocks.filter(
    (block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text",
  );
}

function joinedText(blocks: readonly MessageBlock[]): string {
  return textBlocksOf(blocks)
    .map((block) => block.text)
    .join("");
}

/**
 * The sentinel alone, once or repeated. Text segments of one turn are joined
 * with no separator, so a model that re-emits the sentinel after each tool
 * batch yields `NO_RESPONSENO_RESPONSE`; that is still a silent reply, not prose.
 */
const SENTINEL_ONLY = /^(?:NO_RESPONSE\s*)+$/;

/**
 * Markdown or punctuation a model wraps the sentinel in: `NO_RESPONSE`, **NO_RESPONSE**,
 * "NO_RESPONSE." and the like. Wrapped, it is still the sentinel, never prose.
 */
const DECORATION = "[*_`\"'\u201c\u201d\u2018\u2019()\\[\\].!]*";
const DECORATED_SENTINEL_ONLY = new RegExp(`^(?:${DECORATION}NO_RESPONSE${DECORATION}\\s*)+$`);
/** A line holding only the (possibly wrapped) sentinel, wherever it sits in a reply. */
const SENTINEL_LINE = new RegExp(`^[ \\t>]*${DECORATION}NO_RESPONSE${DECORATION}[ \\t]*$`);

/** True when trimmed text is only the silent-reply sentinel, once or repeated. Extra prose does not match. */
export function isExactNoResponse(text: string): boolean {
  const trimmed = text.trim();
  return SENTINEL_ONLY.test(trimmed) || DECORATED_SENTINEL_ONLY.test(trimmed);
}

const DECORATION_CHARS =
  /^[\s*_`"'\u201c\u201d\u2018\u2019()[\].!>]+|[\s*_`"'\u201c\u201d\u2018\u2019()[\].!]+$/g;

/**
 * True while streamed text could still turn out to be only the sentinel (`NO_RES`, `**NO_`, or
 * a complete one). Live progress holds such text back, so a silent reply never flashes the
 * token on screen or reaches a voice reader before the final reply drops it.
 */
export function mayBecomeNoResponse(text: string): boolean {
  let rest = text.replace(DECORATION_CHARS, "");
  if (!rest) return false;
  while (rest.startsWith(NO_RESPONSE))
    rest = rest.slice(NO_RESPONSE.length).replace(DECORATION_CHARS, "");
  return rest === "" || NO_RESPONSE.startsWith(rest);
}

/** Remove lines that hold only the sentinel; prose lines, and sentinels inside them, stay. */
function withoutSentinelLines(text: string): string {
  if (!text.includes(NO_RESPONSE)) return text;
  const lines = text.split("\n");
  const kept = lines.filter((line) => !SENTINEL_LINE.test(line));
  if (kept.length === lines.length) return text;
  const contentLines = lines.filter((line) => line.trim());
  let cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n");
  // Only whitespace a removed edge line leaves behind is trimmed.
  if (SENTINEL_LINE.test(contentLines[0] ?? "")) cleaned = cleaned.trimStart();
  if (SENTINEL_LINE.test(contentLines.at(-1) ?? "")) cleaned = cleaned.trimEnd();
  return cleaned;
}

/** The same, applied to the assembled reply and each text block; emptied blocks are dropped. */
function withoutSentinelLinesInReply(
  assembled: string,
  blocks: MessageBlock[],
): { assembled: string; blocks: MessageBlock[] } {
  if (!assembled.includes(NO_RESPONSE) && !joinedText(blocks).includes(NO_RESPONSE))
    return { assembled, blocks };
  const cleanedBlocks = blocks.flatMap<MessageBlock>((block) => {
    if (block.kind !== "text") return [block];
    // A block that is only the sentinel may be one glued piece of a longer line.
    if (!block.text.includes("\n") && isExactNoResponse(block.text)) return [block];
    const text = withoutSentinelLines(block.text);
    if (text === block.text) return [block];
    return text.trim() ? [{ ...block, text }] : [];
  });
  return { assembled: withoutSentinelLines(assembled), blocks: cleanedBlocks };
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_]/;
const WHITESPACE = /\s/;

/**
 * Edge runs of the sentinel, glued or spaced. Each token must end at a word
 * boundary to count: a token that continues into an identifier such as
 * `NO_RESPONSE_POLICY` is a word, so the run stops at the last clean token
 * before it instead of being abandoned altogether.
 */
function proseRange(text: string): { start: number; end: number } {
  let cursor = text.length - text.trimStart().length;
  let start = 0;
  while (text.startsWith(NO_RESPONSE, cursor)) {
    cursor += NO_RESPONSE.length;
    if (!IDENTIFIER_CHAR.test(text[cursor] ?? "")) {
      while (cursor < text.length && WHITESPACE.test(text[cursor]!)) cursor++;
      start = cursor;
    } else if (!text.startsWith(NO_RESPONSE, cursor)) {
      break;
    }
  }
  // Scan backwards from the end so long whitespace cannot cause suffix backtracking.
  cursor = text.trimEnd().length;
  let end = text.length;
  while (cursor - NO_RESPONSE.length >= start && text.endsWith(NO_RESPONSE, cursor)) {
    cursor -= NO_RESPONSE.length;
    if (cursor <= start || !IDENTIFIER_CHAR.test(text[cursor - 1] ?? "")) {
      while (cursor > start && WHITESPACE.test(text[cursor - 1]!)) cursor--;
      end = cursor;
    } else if (!(cursor - NO_RESPONSE.length >= start && text.endsWith(NO_RESPONSE, cursor))) {
      break;
    }
  }
  return { start, end };
}

/**
 * Silent-reply stripper. If the trimmed final text is exactly `NO_RESPONSE`,
 * drop that text so the run can finish with no chat bubble. Sibling tool/step
 * blocks do not count as extra prose. Surrounding words keep the reply; only a
 * stray sentinel at the start or end of that prose is removed from it.
 */
export function stripNoResponseReply(
  assembled: string,
  blocks: MessageBlock[],
): { assembled: string; blocks: MessageBlock[] } {
  const assembledTrimmed = assembled.trim();
  const blockText = joinedText(blocks).trim();
  const visible = assembledTrimmed || blockText;
  if (!isExactNoResponse(visible)) {
    const cleaned = withoutSentinelLinesInReply(assembled, blocks);
    return withoutStraySentinelsAtEdges(cleaned.assembled, cleaned.blocks);
  }
  // Fail closed: extra prose in either the assembled final or a text block keeps the reply.
  if (assembledTrimmed && blockText && !isExactNoResponse(blockText)) {
    return { assembled, blocks };
  }
  return {
    assembled: "",
    blocks: blocks.filter((block) => block.kind !== "text"),
  };
}

/**
 * For runs that must reply: drop stray sentinels from a reply with prose, such as one a late
 * follow-up message adds after the final answer. A sentinel-only reply loses its text too: the
 * literal token is never shown to a person, and the caller's empty-reply fallback applies.
 */
export function stripStrayNoResponse(
  assembled: string,
  blocks: MessageBlock[],
): { assembled: string; blocks: MessageBlock[] } {
  const visible = assembled.trim() || joinedText(blocks).trim();
  if (isExactNoResponse(visible)) {
    // Fail closed, as for silent runs: prose anywhere keeps the reply.
    const blockText = joinedText(blocks).trim();
    if (assembled.trim() && blockText && !isExactNoResponse(blockText)) {
      return withoutStraySentinelsAtEdges(assembled, blocks);
    }
    return { assembled: "", blocks: blocks.filter((block) => block.kind !== "text") };
  }
  const cleaned = withoutSentinelLinesInReply(assembled, blocks);
  return withoutStraySentinelsAtEdges(cleaned.assembled, cleaned.blocks);
}

/** What a bot asked by another bot returns when it answers with only the sentinel. */
export const PEER_NOTHING_NEW_REPLY = "Nothing new to add.";

/**
 * For a request or question from another bot: a sentinel-only reply would reach the
 * asker as the literal token, so say it in words instead. Other replies are handled as above.
 */
export function peerReplyWithoutSentinel(
  assembled: string,
  blocks: MessageBlock[],
): { assembled: string; blocks: MessageBlock[] } {
  const visible = assembled.trim() || joinedText(blocks).trim();
  if (!isExactNoResponse(visible)) return stripStrayNoResponse(assembled, blocks);
  return {
    assembled: PEER_NOTHING_NEW_REPLY,
    blocks: [
      ...blocks.filter((block) => block.kind !== "text"),
      { kind: "text", text: PEER_NOTHING_NEW_REPLY },
    ],
  };
}

/** A reply with prose stays a reply; a sentinel misplaced at its edge is dropped from what the user sees. */
function withoutStraySentinelsAtEdges(
  assembled: string,
  blocks: MessageBlock[],
): { assembled: string; blocks: MessageBlock[] } {
  const assembledRange = proseRange(assembled);
  const cleanedAssembled = assembled.slice(assembledRange.start, assembledRange.end);
  const blockText = joinedText(blocks);
  const { start, end } = proseRange(blockText);
  if (start === 0 && end === blockText.length) {
    return { assembled: cleanedAssembled, blocks };
  }

  let offset = 0;
  const cleanedBlocks = blocks.flatMap<MessageBlock>((block) => {
    if (block.kind !== "text") return [block];
    const blockStart = offset;
    offset += block.text.length;
    const text = block.text.slice(Math.max(0, start - blockStart), Math.max(0, end - blockStart));
    if (text === block.text) return [block];
    return text ? [{ ...block, text }] : [];
  });
  return { assembled: cleanedAssembled, blocks: cleanedBlocks };
}
