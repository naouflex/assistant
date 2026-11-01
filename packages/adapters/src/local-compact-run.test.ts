import type { SimpleStreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  COMPACT_CORE_BUILTIN_TOOL_NAMES,
  compactToolSet,
  FIND_TOOL,
  partitionTools,
  USE_TOOL,
} from "./builtin-tool-bridge.js";
import { selfHostedPayload, withChatCompletionsCompatibility } from "./chat-completions-compat.js";
import { formatCurrentTimeInstruction } from "./current-time.js";
import { namedAgentTools } from "./pi-runtime-tools.js";
import {
  compactEnvironmentInstruction,
  compactInstructionsEnabled,
  compactSandboxInstruction,
  compactUserTurnInstructions,
  ownerFolderNote,
  userTurnInstructions,
  windowsShellAside,
  wslPlaceNote,
} from "./run-instructions.js";
import { selectBuiltinToolsForRun } from "./run-tool-selection.js";

const ownerChat = selectBuiltinToolsForRun({
  graphicalToolsAllowed: false,
  groupId: null,
  trigger: "user",
  semanticMemoryEnabled: false,
  historyRetrievalEnabled: true,
  messagingChannelRun: false,
  fleetManagement: true,
  followUpFromUser: true,
});

const parts = {
  botInstructions: "You are Chief, Naoufel's chief of staff.",
  groupContext: undefined,
  messagingContext: undefined,
  redactedMemoryContext: "Owner facts: prefers short answers.",
  redactedScratchpadContext: undefined,
  hasHistoricalContext: true,
  historyRetrievalEnabled: true,
  computerInstruction: "Use the computer only when needed. ".repeat(80),
  pageBrowserAllowed: true,
  workspaceInstruction: "This entire computer workspace is your private home.",
  agentEnvironmentInstruction: undefined,
  botDirectory: "Teammates: Scout, Ledger.",
  pluginLine: "Connected apps: Gmail, Slack.",
  agentSkillsLine: "Skills: scheduling, travel.",
  taughtSkillsLine: undefined,
  replyGuidance: "Reply in the chat.",
};

const join = (blocks: (string | undefined)[]) => blocks.filter(Boolean).join("\n\n");
const listedBytes = (tools: ReturnType<typeof partitionTools>["listed"]) =>
  JSON.stringify(
    namedAgentTools(tools).map(({ tool, name }) => ({
      name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
  ).length;

describe("compact local runs", () => {
  it("turns on for the local provider and honours the env switch", () => {
    expect(compactInstructionsEnabled("local", {})).toBe(true);
    expect(compactInstructionsEnabled("openai", {})).toBe(false);
    expect(compactInstructionsEnabled("local", { ATLAS_LOCAL_COMPACT_PROMPT: "false" })).toBe(
      false,
    );
    expect(
      compactInstructionsEnabled("openai-compatible", { ATLAS_LOCAL_COMPACT_PROMPT: "always" }),
    ).toBe(true);
  });

  it("keeps the house rules in a fraction of the full prompt", () => {
    const compact = join(compactUserTurnInstructions(parts));
    const full = join(userTurnInstructions(parts));
    expect(compact).toContain("Answer first.");
    expect(compact).toContain("sends wait for the owner's approval card");
    expect(compact).toContain("Never invent facts");
    expect(compact).toContain("untrusted");
    expect(compact).toContain("find_tool");
    expect(compact).toContain(parts.botInstructions);
    // Per-turn context stays last so the stable prefix is shared between turns.
    expect(compact.indexOf(parts.redactedMemoryContext)).toBeGreaterThan(
      compact.indexOf("find_tool"),
    );
    expect(compact).not.toContain(parts.botDirectory);
    expect(compact.length).toBeLessThan(full.length / 2);
    expect(compact.length).toBeLessThan(4_000);
  });

  it("is byte-stable across turns: the clock rides on the user message", () => {
    const first = join(compactUserTurnInstructions(parts));
    const second = join(compactUserTurnInstructions({ ...parts }));
    expect(second).toBe(first);
    const now = formatCurrentTimeInstruction(new Date("2026-10-31T10:00:00Z"), "Europe/Paris");
    expect(first).not.toContain(now.slice(0, 30));
  });

  it("lists only the compact core and defers other built-ins behind find_tool", () => {
    const { listed, deferred } = partitionTools(compactToolSet(ownerChat));
    const names = listed.map((tool) => tool.name);
    expect(names).toContain(FIND_TOOL);
    expect(names).toContain(USE_TOOL);
    for (const name of names) {
      if (name === FIND_TOOL || name === USE_TOOL) continue;
      expect(COMPACT_CORE_BUILTIN_TOOL_NAMES.has(name)).toBe(true);
    }
    expect(deferred.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["schedule_create", "update_bot"]),
    );
    expect(listedBytes(listed)).toBeLessThan(listedBytes(partitionTools(ownerChat).listed) / 2);
    // The deferred marker is in-process only.
    expect(JSON.stringify(namedAgentTools(listed))).not.toContain('"deferred"');
  });

  it("keeps the listed tool block identical between turns", () => {
    const a = partitionTools(compactToolSet(ownerChat)).listed;
    const b = partitionTools(compactToolSet([...ownerChat].reverse())).listed;
    expect(JSON.stringify(namedAgentTools(b))).toBe(JSON.stringify(namedAgentTools(a)));
  });

  it("leaves connector tools listed", () => {
    const connector = { name: "gmail_search", description: "Search mail", inputSchema: {} };
    const { listed } = partitionTools(compactToolSet([...ownerChat, connector]));
    expect(listed.map((tool) => tool.name)).toContain("gmail_search");
  });
});

describe("self-hosted chat-completions payloads", () => {
  const local = {
    api: "openai-completions" as const,
    id: "qwen3.5:9b",
    baseUrl: "http://127.0.0.1:11434/v1",
    provider: "local",
  };
  const noOptions: SimpleStreamOptions = {};
  const payload = { model: "qwen3.5:9b", messages: [], max_completion_tokens: 4096 };

  it("mirrors max_completion_tokens to max_tokens, which Ollama reads", () => {
    expect(selfHostedPayload(payload, {})).toEqual({ ...payload, max_tokens: 4096 });
    expect(selfHostedPayload({ ...payload, max_tokens: 10 }, {})).toBeUndefined();
  });

  it("turns thinking off in every spelling when asked", () => {
    expect(selfHostedPayload(payload, { disableThinking: true })).toEqual({
      ...payload,
      max_tokens: 4096,
      think: false,
      reasoning_effort: "none",
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it("applies only to self-hosted providers and only with the env switch", async () => {
    const off = withChatCompletionsCompatibility(local, noOptions, {});
    expect(await off.onPayload?.(payload, local as never)).toEqual({
      ...payload,
      max_tokens: 4096,
    });
    const on = withChatCompletionsCompatibility(local, noOptions, {
      ATLAS_LOCAL_DISABLE_THINKING: "true",
    });
    expect(await on.onPayload?.(payload, local as never)).toMatchObject({ think: false });
    const hosted = { ...local, provider: "openai", baseUrl: "https://api.openai.com/v1" };
    const cloud = withChatCompletionsCompatibility(hosted, noOptions, {
      ATLAS_LOCAL_DISABLE_THINKING: "true",
    });
    expect(await cloud.onPayload?.(payload, hosted as never)).toBeUndefined();
  });
  it("answers whatever the role and explains where the shell runs", () => {
    const compact = join(compactUserTurnInstructions(parts));
    expect(compact).toContain("answer whatever the owner asks directly");
    expect(compact).toContain("never tell the owner to install WSL");
    expect(compact).toContain("schedule_create");
    expect(
      join(compactUserTurnInstructions({ ...parts, userComputer: "connected" })),
    ).not.toContain("own Linux sandbox");
    const connected = join(compactUserTurnInstructions({ ...parts, userComputer: "connected" }));
    expect(connected).toContain("user_computer_shell");
    expect(connected).toContain("Downloads");
    const offline = join(compactUserTurnInstructions({ ...parts, userComputer: "offline" }));
    expect(offline).toContain("Atlas desktop app");
    expect(offline).not.toContain("cannot see the owner's files");
  });

  it("keeps the bot's computer, Windows, and WSL apart", () => {
    const windows = compactEnvironmentInstruction({
      userComputer: "connected",
      userComputerPlatform: "win32",
    });
    expect(windows).toContain("own Linux computer");
    expect(windows).toContain("PowerShell");
    expect(windows).toContain("wsl -e ls ~");
    expect(windows).toContain("Never tell them to install WSL");
    expect(windows).not.toContain("own Linux sandbox");
    const mounted = compactEnvironmentInstruction(
      { userComputer: "connected", userComputerPlatform: "win32" },
      { SANDBOX_COMPUTER_MOUNTS: "/home/naoufel/code:/mnt/naoufel/code:ro" },
    );
    expect(mounted).toContain("/mnt/naoufel/code");
    expect(mounted).toContain("use shell on these /mnt paths");
    expect(mounted).toContain("not on this computer or on Windows");
    const ownWindows = compactEnvironmentInstruction({ ownShellPlatform: "win32" });
    expect(ownWindows).toContain("PowerShell");
    expect(ownWindows).toContain("list them with shell");
    expect(ownWindows).not.toContain("user_computer_shell");
    const mac = join(
      compactUserTurnInstructions({
        ...parts,
        userComputer: "connected",
        userComputerPlatform: "darwin",
      }),
    );
    expect(mac).toContain("separate from theirs");
    expect(mac).not.toContain("PowerShell");
    const full = join(
      userTurnInstructions({
        ...parts,
        userComputer: "connected",
        userComputerPlatform: "win32",
      }),
    );
    expect(full).toContain("separate from your shell and from their WSL");
    expect(
      join(
        userTurnInstructions({
          ...parts,
          userComputer: "connected",
          userComputerPlatform: "win32",
          ownShellPlatform: "win32",
        }),
      ),
    ).not.toContain("separate from your shell and from their WSL");
    expect(windowsShellAside("win32")).toContain("not WSL");
    expect(windowsShellAside("darwin")).toBe("");
    expect(
      wslPlaceNote("list my WSL home", {
        userComputer: "connected",
        userComputerPlatform: "win32",
      }),
    ).toContain("user_computer_shell");
    expect(
      wslPlaceNote("list my WSL home", {
        userComputer: "connected",
        userComputerPlatform: "win32",
        mounts: "/home/n/code:/mnt/n/code:ro",
      }),
    ).toBeUndefined();
    expect(wslPlaceNote("list my WSL home", {})).toContain("not their WSL");
    expect(
      wslPlaceNote("hello", { userComputer: "connected", userComputerPlatform: "win32" }),
    ).toBeUndefined();
  });

  it("sends a personal folder to the owner's computer", () => {
    const ask = "list files in download folder";
    expect(ownerFolderNote(ask, { userComputer: "connected" })).toContain("user_computer_shell");
    expect(ownerFolderNote(ask, { userComputer: "offline" })).toContain("Atlas desktop app");
    expect(ownerFolderNote(ask, { userComputer: "offline" })).toContain("Do not invent file names");
    expect(ownerFolderNote(ask, { userComputer: undefined })).toBeUndefined();
    expect(ownerFolderNote("hello chief", { userComputer: "connected" })).toBeUndefined();
    expect(ownerFolderNote(ask, { userComputer: "connected", voiceCall: true })).toBeUndefined();
  });

  it("names mounted owner folders when the sandbox has them", () => {
    expect(compactSandboxInstruction({})).toContain("cannot see the owner's files");
    const mounted = compactSandboxInstruction({
      SANDBOX_COMPUTER_MOUNTS: "/home/naoufel/code:/mnt/naoufel/code:ro, /srv/x:/srv/x:rw",
    });
    expect(mounted).toContain("/mnt/naoufel/code (read-only) = their /home/naoufel/code");
    expect(mounted).toContain("/srv/x = their /srv/x");
  });

  it("groups many repo mounts under one parent into a short list", () => {
    const grouped = compactSandboxInstruction({
      SANDBOX_COMPUTER_MOUNTS:
        "/home/naoufel/a:/mnt/naoufel/a:ro,/home/naoufel/b:/mnt/naoufel/b:ro,/home/naoufel/c/d:/mnt/naoufel/c/d:ro",
    });
    expect(grouped).toContain(
      "their /home/naoufel/<name> at /mnt/naoufel/<name> (read-only) for a, b, c/d",
    );
    expect(grouped).toContain("git repos");
  });
});
