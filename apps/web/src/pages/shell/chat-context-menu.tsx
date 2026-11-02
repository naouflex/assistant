import type { Bot, BotSection, Group } from "@atlas/contracts";
import { toast } from "@atlas/ui-web";
import { useLingui } from "@lingui/react/macro";
import { lazyOverlay } from "../../components/ErrorBoundary";
import { useOwnSpaces } from "../../components/integrations/space-availability";
import type { createSpaceRpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import type { ShellDialogsState } from "./shell-dialogs";
import type { useChatRead } from "./use-chat-read";

const BotContextMenu = lazyOverlay(() =>
  import("../BotContextMenu").then((module) => module.BotContextMenu),
);

type ChatRead = ReturnType<typeof useChatRead>;

/** The right-click menu for a bot or group in the roster. */
export function ChatContextMenu({
  rpc,
  bot,
  bots,
  group,
  sections,
  spaceId,
  onClose,
  refreshBots,
  read,
  dialogs,
  openChatSettings,
  navigate,
}: {
  rpc: ReturnType<typeof createSpaceRpc>;
  bot: Bot | undefined;
  bots: Bot[];
  group: Group | undefined;
  sections: BotSection[];
  spaceId: string | undefined;
  onClose: () => void;
  refreshBots: (includeArchived?: boolean) => Promise<void>;
  read: Pick<ChatRead, "markBotRead" | "markBotUnread" | "toggleGroupUnread">;
  dialogs: ShellDialogsState;
  openChatSettings: (kind: "bot" | "group", id: string) => void;
  navigate: (path: string) => void;
}) {
  const { t } = useLingui();
  const ownSpaces = useOwnSpaces();
  const chat = bot ?? group;
  if (!chat) return null;
  const otherSpaces = ownSpaces.filter((space) => space.id !== spaceId);
  const parents = bot ? bots.filter((item) => item.id !== bot.id && !item.archivedAt) : undefined;
  const target = bot
    ? { kind: "bot" as const, chat: bot }
    : { kind: "group" as const, chat: group! };
  return (
    <BotContextMenu
      bot={chat}
      onClose={onClose}
      sections={sections}
      onTogglePinned={() => {
        onClose();
        const request = bot
          ? rpc.bots.update({ botId: bot.id, pinned: !bot.pinned })
          : rpc.groups.update({
              groupId: group!.id,
              pinned: !group!.pinned,
            });
        void request.then(() => refreshBots());
      }}
      onToggleUnread={() => {
        const unread = !chat.unread;
        onClose();
        if (bot) {
          const request = unread ? read.markBotUnread(bot.id) : read.markBotRead(bot.id);
          void request.catch(() => undefined);
        } else {
          read.toggleGroupUnread(group!.id, unread);
        }
      }}
      onMoveToSection={(sectionId) => {
        onClose();
        if (sectionId === chat.sectionId) return;
        const request = bot
          ? rpc.bots.update({ botId: bot.id, sectionId })
          : rpc.groups.update({ groupId: group!.id, sectionId });
        void request.then(() => refreshBots());
      }}
      onCreateSection={() => {
        dialogs.setNewSectionTarget(target);
        onClose();
      }}
      onRenameSection={(sectionId) => {
        const section = sections.find((item) => item.id === sectionId);
        if (section && spaceId) dialogs.setRenameSectionTarget({ section, spaceId });
        onClose();
      }}
      onEdit={() => {
        openChatSettings(bot ? "bot" : "group", chat.id);
        onClose();
      }}
      onDuplicate={() => {
        onClose();
        const request = bot
          ? rpc.bots.duplicate({ botId: bot.id })
          : rpc.groups.duplicate({ groupId: group!.id });
        void request.then(async (copy) => {
          await refreshBots();
          navigate(bot ? `/app/${copy.id}` : `/app/g/${copy.id}`);
        });
      }}
      onClear={() => {
        dialogs.setClearTarget(target);
        onClose();
      }}
      onArchive={() => {
        onClose();
        const request = bot
          ? rpc.bots.archive({ botId: bot.id })
          : rpc.groups.archive({ groupId: group!.id });
        void request.then(() => refreshBots(true));
      }}
      spaces={bot ? otherSpaces : undefined}
      onMoveToSpace={(targetSpaceId) => {
        onClose();
        if (!bot) return;
        const name = otherSpaces.find((space) => space.id === targetSpaceId)?.name ?? "";
        void rpc.bots
          .move({ botId: bot.id, spaceId: targetSpaceId })
          .then(async () => {
            toast.success(t`Moved ${bot.name} to ${name}`);
            await refreshBots();
          })
          .catch((err: unknown) => toast.error(errorText(err, t`Could not move this bot.`)));
      }}
      parents={parents}
      parentBotId={bot?.parentBotId ?? null}
      onSetParent={(parentBotId) => {
        onClose();
        if (!bot || parentBotId === bot.parentBotId) return;
        void rpc.bots
          .setParent({ botId: bot.id, parentBotId })
          .then(() => refreshBots())
          .catch((err: unknown) => toast.error(errorText(err, t`Could not change the parent.`)));
      }}
      onDelete={() => {
        if (bot) dialogs.setDeleteTarget(bot);
        else dialogs.setDeleteGroupTarget(group!);
        onClose();
      }}
    />
  );
}
