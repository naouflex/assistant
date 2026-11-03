import { disabledBuiltinToolSet, FLEET_TOOL_NAMES, FLEET_WRITE_TOOL_NAMES } from "@atlas/contracts";
import { isBackgroundRunTrigger, isOwnerStartedRun } from "@atlas/core";
import { builtinAgentTools } from "./builtin-tools.js";
import { selectCloudAgentTools } from "./cloud-agent-tools-select.js";
import { selectMemoryTools } from "./memory-tools.js";
import { filterImageReturningComputerTools } from "./model-vision.js";
import { PHONE_TOOLS } from "./phone-protocol.js";
import { USER_COMPUTER_SCREEN_TOOLS } from "./run-tools-user-computer.js";
import { filterBuiltinToolsForRun, filterBuiltinToolsForThread } from "./schedule-tools.js";

export const READ_ONLY_AGENT_TOOLS = new Set([
  "computer_observe",
  "list_files",
  "list_fleet",
  "read_file",
  "read_history",
  "read_memory",
  "search_history",
  "search_memory",
  "request_takeover",
  "run_subagent",
  "task_catalog",
  "recall_memory",
  "schedule_list",
  "scratchpad_list",
  "board_tickets",
  "ticket_get",
  "skill_read",
  "web_search",
  "web_fetch",
  "browser_snapshot",
  "list_secrets",
  "cloud_agent_status",
  "purchase_status",
]);

/** Offered only to a user who connected a wallet. */
const PURCHASE_TOOL_NAMES = new Set(["request_purchase", "purchase_status", "paid_request"]);

export const BUILTIN_AGENT_TOOL_NAMES = new Set(builtinAgentTools.map((tool) => tool.name));

const FLEET_TOOL_NAMES_SET: ReadonlySet<string> = new Set(FLEET_TOOL_NAMES);

export const FLEET_WRITE_TOOL_NAMES_SET: ReadonlySet<string> = new Set(FLEET_WRITE_TOOL_NAMES);

/**
 * The creation intro asks what the bot is for and records the answer on its own profile.
 * It must not act (shell, computer, scheduling, spawning another bot, ...) before the user
 * has said what it is for. Answering its question resumes it as the user's turn, with
 * every tool (see commitAnswerRunInput).
 */
const CREATED_RUN_TOOL_NAMES = new Set(["ask_user", "update_bot"]);

export function selectBuiltinToolsForRun(options: {
  ticketBoardEnabled?: boolean;
  phoneCallsEnabled?: boolean;
  historyRetrievalEnabled?: boolean;
  graphicalToolsAllowed: boolean;
  /** Page browser tools need a graphical computer (Chrome), not model vision. */
  pageBrowserAllowed?: boolean;
  groupId: string | null;
  trigger: string;
  semanticMemoryEnabled: boolean;
  /** The configured provider can forget individual facts. */
  semanticMemoryForgets?: boolean;
  cloudAgentEnabled?: boolean;
  /** The run's user connected a payment wallet. */
  paymentWalletEnabled?: boolean;
  mediaImagesEnabled?: boolean;
  mediaVideoEnabled?: boolean;
  messagingChannelRun: boolean;
  /** Hanging up is only offered to a turn the caller spoke on a live call. */
  voiceCall?: boolean;
  /** Built-in names this bot turned off. Unknown names are ignored. */
  disabledBuiltinTools?: readonly string[];
  fleetManagement?: boolean;
  /** A follow-up run whose source message the user wrote. */
  followUpFromUser?: boolean;
  /** The person who started this run has their desktop connected (see userComputerOwner). */
  userComputer?: boolean;
  /** That desktop can look at and drive its apps. */
  userComputerScreen?: boolean;
  /** The person who started this run has their phone online with Phone control on. */
  phone?: boolean;
}) {
  const disabled = disabledBuiltinToolSet(options.disabledBuiltinTools);
  const ownerStartedRun = isOwnerStartedRun(options.trigger, Boolean(options.followUpFromUser));
  return selectCloudAgentTools(
    selectMemoryTools(
      filterBuiltinToolsForRun(
        filterBuiltinToolsForThread(
          filterPageBrowserTools(
            filterImageReturningComputerTools(builtinAgentTools, options.graphicalToolsAllowed),
            options.pageBrowserAllowed ?? options.graphicalToolsAllowed,
          ),
          options.groupId,
        ),
        options.trigger,
      ),
      options.semanticMemoryEnabled,
      Boolean(options.semanticMemoryForgets),
    ),
    Boolean(options.cloudAgentEnabled),
  ).filter(
    (tool) =>
      !disabled.has(tool.name) &&
      (options.trigger !== "created" || CREATED_RUN_TOOL_NAMES.has(tool.name)) &&
      (!FLEET_TOOL_NAMES_SET.has(tool.name) ||
        (Boolean(options.fleetManagement) && ownerStartedRun)) &&
      (ownerStartedRun || (tool.name !== "update_preferences" && tool.name !== "feedback")) &&
      (options.paymentWalletEnabled || !PURCHASE_TOOL_NAMES.has(tool.name)) &&
      (options.mediaImagesEnabled || tool.name !== "generate_image") &&
      (options.mediaVideoEnabled || tool.name !== "generate_video") &&
      (options.ticketBoardEnabled ||
        (tool.name !== "board_tickets" && !tool.name.startsWith("ticket_"))) &&
      (!isBackgroundRunTrigger(options.trigger) ||
        ![
          "message_user",
          "message_bot",
          "handoff_to_bot",
          "message_agent",
          "generate_image",
          "generate_video",
        ].includes(tool.name)) &&
      (options.voiceCall || tool.name !== "end_call") &&
      (options.userComputer || tool.name !== "user_computer_shell") &&
      ((options.userComputer && options.userComputerScreen) ||
        !USER_COMPUTER_SCREEN_TOOLS.has(tool.name)) &&
      (options.phone || !PHONE_TOOLS.has(tool.name)) &&
      // Already on a call, or reached through a messaging channel that cannot ring.
      ((options.phoneCallsEnabled &&
        !options.groupId &&
        !options.voiceCall &&
        !options.messagingChannelRun &&
        !isBackgroundRunTrigger(options.trigger)) ||
        tool.name !== "call_user") &&
      (options.historyRetrievalEnabled ||
        !["search_history", "read_history"].includes(tool.name)) &&
      (!options.messagingChannelRun ||
        (![
          "remember",
          "save_shared_memory",
          "save_memory",
          "recall_memory",
          "forget_memory",
          "task_catalog",
          "board_tickets",
        ].includes(tool.name) &&
          !tool.name.startsWith("scratchpad_") &&
          !tool.name.startsWith("ticket_"))),
  );
}

export const PAGE_BROWSER_TOOL_NAMES = new Set([
  "browser_navigate",
  "browser_snapshot",
  "browser_act",
]);

const TURN_TOOL_MIN = 8;
const TURN_TOOL_MAX = 12;
const ALWAYS_LISTED_TOOLS = ["ask_user", "message_user", "shell", "web_search", "read_file", "write_file"];

/**
 * List about 8–12 tools that match this turn. The rest stay deferred behind find_tool.
 * A short list is left whole.
 */
export function focusTurnTools<T extends { name: string; description?: string; deferred?: boolean }>(
  tools: readonly T[],
  input: { prompt: string; recentText?: string },
): T[] {
  const candidates = tools.filter((tool) => tool.name !== "find_tool" && tool.name !== "use_tool");
  if (candidates.length <= TURN_TOOL_MAX) return [...tools];
  const haystack = `${input.prompt}\n${input.recentText ?? ""}`.toLowerCase();
  const score = (tool: T) => {
    let points = ALWAYS_LISTED_TOOLS.includes(tool.name) ? 8 : 0;
    const spaced = tool.name.replaceAll("_", " ");
    if (haystack.includes(spaced) || haystack.includes(tool.name)) points += 5;
    for (const word of tool.name.split("_")) {
      if (word.length > 3 && haystack.includes(word)) points += 2;
    }
    const description = tool.description?.toLowerCase() ?? "";
    for (const word of haystack.split(/[^a-z0-9]+/).filter((part) => part.length > 4)) {
      if (description.includes(word)) points += 1;
    }
    return points;
  };
  const ranked = [...candidates].sort(
    (left, right) => score(right) - score(left) || left.name.localeCompare(right.name),
  );
  const keep = new Set<string>();
  for (const name of ALWAYS_LISTED_TOOLS) {
    if (candidates.some((tool) => tool.name === name)) keep.add(name);
  }
  for (const tool of ranked) {
    if (keep.size >= TURN_TOOL_MAX) break;
    keep.add(tool.name);
  }
  return tools.map((tool) =>
    keep.has(tool.name) || tool.name === "find_tool" || tool.name === "use_tool"
      ? tool
      : { ...tool, deferred: true },
  );
}

export function filterPageBrowserTools<T extends { name: string }>(
  tools: T[],
  pageBrowserAllowed: boolean,
): T[] {
  if (pageBrowserAllowed) return tools;
  return tools.filter((tool) => !PAGE_BROWSER_TOOL_NAMES.has(tool.name));
}

/** The fleet tools this run was offered, the same decision as tool selection. */
export function offeredFleetTools(tools: readonly { name: string }[]): string[] {
  return tools.map((tool) => tool.name).filter((name) => FLEET_TOOL_NAMES_SET.has(name));
}
