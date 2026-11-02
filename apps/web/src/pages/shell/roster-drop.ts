import { GROUP_MEMBER_MAX } from "@atlas/contracts";
import { isRunWorking } from "@atlas/core";

type DraggedBot = {
  id: string;
  sectionId: string | null;
  pinned: boolean;
  parentBotId?: string | null;
  spaceId?: string;
  status?: string;
};

export type RosterDropTarget =
  | {
      kind: "bot";
      chat: { id: string; sectionId: string | null; pinned: boolean };
      /** The pointer is over the middle of the row: nest under this bot. */
      nest?: boolean;
    }
  | { kind: "group"; chat: { id: string; memberIds: readonly string[] } }
  | { kind: "section"; sectionId: string | null }
  | { kind: "space"; spaceId: string; spaceName: string };

export type RosterDropAction =
  | { action: "reorder"; targetBotId: string }
  | { action: "move"; sectionId: string | null }
  | { action: "join"; groupId: string; botIds: string[] }
  | { action: "parent"; parentBotId: string }
  | { action: "space"; spaceId: string; spaceName: string };

/** True when `botId` sits somewhere under `ancestorId` in the parent tree. */
export function isBotDescendant(
  bots: readonly { id: string; parentBotId?: string | null }[],
  botId: string,
  ancestorId: string,
): boolean {
  const parents = new Map(bots.map((bot) => [bot.id, bot.parentBotId ?? null]));
  const seen = new Set<string>();
  let current = parents.get(botId) ?? null;
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = parents.get(current) ?? null;
  }
  return false;
}

/**
 * Decide what dropping a dragged bot on a sidebar target does. Dropping on a
 * sibling row reorders; dropping on another section (its header or one of its
 * rows) moves the bot there; dropping on a group chat adds the bot as a member;
 * dropping on the middle of a bot row nests the dragged bot under it; dropping
 * on another space moves the bot to that space. Pinned bots live in the Pinned
 * list, so they only reorder. Returns null when the drop should be refused.
 */
export function resolveRosterDrop(input: {
  dragged: DraggedBot;
  target: RosterDropTarget;
  /** True when the target and dragged rows belong to the same visible list. */
  sameList: boolean;
  /** Bots of the active space, for the descendant check. */
  bots?: readonly { id: string; parentBotId?: string | null }[];
}): RosterDropAction | null {
  const { dragged, target } = input;
  const working = isRunWorking(dragged.status);
  switch (target.kind) {
    case "bot": {
      if (target.chat.id === dragged.id) return null;
      if (target.nest) {
        if (working || target.chat.id === dragged.parentBotId) return null;
        if (isBotDescendant(input.bots ?? [], target.chat.id, dragged.id)) return null;
        return { action: "parent", parentBotId: target.chat.id };
      }
      if (dragged.pinned !== target.chat.pinned) return null;
      if (dragged.pinned || target.chat.sectionId === dragged.sectionId) {
        return input.sameList ? { action: "reorder", targetBotId: target.chat.id } : null;
      }
      return { action: "move", sectionId: target.chat.sectionId };
    }
    case "section": {
      if (dragged.pinned || target.sectionId === dragged.sectionId) return null;
      return { action: "move", sectionId: target.sectionId };
    }
    case "group": {
      const members = target.chat.memberIds;
      if (members.includes(dragged.id) || members.length >= GROUP_MEMBER_MAX) return null;
      return { action: "join", groupId: target.chat.id, botIds: [...members, dragged.id] };
    }
    case "space": {
      if (working || target.spaceId === dragged.spaceId) return null;
      return { action: "space", spaceId: target.spaceId, spaceName: target.spaceName };
    }
  }
}
