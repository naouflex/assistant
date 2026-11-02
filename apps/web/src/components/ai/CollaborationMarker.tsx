import type { BotAvatarSet } from "@atlas/contracts";
import { formatWorkingLine, splitPeerLabel, workingElapsedLabel } from "@atlas/core";
import type { GroupAvatarMember } from "@atlas/ui-web";
import { BotAvatar, GroupAvatar } from "@atlas/ui-web";
import { useEffect, useState } from "react";

export function CollaborationMarker({
  color,
  avatarSet,
  identity,
  label,
  peerName,
  onClick,
}: {
  color: string;
  avatarSet?: BotAvatarSet;
  identity: string;
  label: string;
  peerName: string;
  onClick: () => void;
}) {
  const parts = splitPeerLabel(label, peerName);
  return (
    <div className="flex min-w-0 max-w-full justify-center py-1">
      <button
        type="button"
        data-testid="peer-receipt-chip"
        aria-label={label}
        onClick={onClick}
        className="inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground/75 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        {parts.before ? <span className="whitespace-pre-wrap">{parts.before}</span> : null}
        <BotAvatar avatarSet={avatarSet} color={color} identity={identity} size={16} />
        {parts.name ? (
          <span dir="auto" className="truncate font-medium">
            {parts.name}
          </span>
        ) : null}
        {parts.after ? <span className="whitespace-pre-wrap">{parts.after}</span> : null}
      </button>
    </div>
  );
}

/** How long this step has been running. Remounting (a new step) starts the count over. */
function WorkingElapsed() {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = workingElapsedLabel(now - startedAt);
  if (!elapsed) return null;
  return (
    <span
      data-testid="working-elapsed"
      className="shrink-0 text-muted-foreground text-xs tabular-nums"
    >
      {elapsed}
    </span>
  );
}

/** The working bot with what it is doing right now, such as its current tool call. */
export function ActiveBotGlyph({ bots, label }: { bots: GroupAvatarMember[]; label: string }) {
  const line = formatWorkingLine(label);
  return (
    <div role="status" className="flex min-h-10 min-w-0 items-center gap-2.5 px-1">
      <GroupAvatar members={bots} size={28} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span dir="auto" className="min-w-0 truncate text-[15px] text-foreground text-shimmer">
            {line.action}
          </span>
          <WorkingElapsed key={`${line.action}\0${line.detail ?? ""}`} />
        </div>
        {line.detail ? (
          <div
            dir="auto"
            title={line.detail}
            className={`truncate text-[13px] leading-4 text-muted-foreground ${line.code ? "font-mono" : ""}`}
          >
            {line.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}
