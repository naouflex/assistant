import type { MessageBlock } from "@atlas/contracts";
import { speechFromBlocks } from "@atlas/core";

/**
 * What a voice reads from a message: the bot's reply and its questions, never the tool steps,
 * activity lines, or cards drawn around them. Every spoken surface (read aloud, auto-speak, a
 * call) goes through here so they cannot drift apart.
 */
export function spokenMessageText(message: { blocks: readonly MessageBlock[] }): string {
  return speechFromBlocks(message.blocks).trim();
}
