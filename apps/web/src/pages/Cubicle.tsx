import type { Bot, RunActivityRow } from "@atlas/contracts";
import {
  cubicleFloor,
  cubicleZoneOrder,
  isRetryableError,
  type CubicleDesk,
  type CubicleExchange,
  type CubicleFloor,
  type CubicleKind,
} from "@atlas/core";
import { BotAvatar, Button, DEFAULT_BOT_AVATAR_COLOR, Spinner } from "@atlas/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQueries } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useOwnSpaces } from "../components/integrations/space-availability";
import { activityPreview } from "../lib/activity-list-filters";
import { desktopBridge } from "../lib/desktop";
import { formatRelativeTime } from "../lib/relative-time";
import { compactRosterStatusLabel } from "../lib/roster-status";
import { rpcForSpace, selectedSpaceId, selectSpace } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { statusTone } from "./ActivityList";
import { WindowChrome } from "./WindowChrome";

type SpaceTarget = { id: string; name: string };

type SpacePayload = {
  bots: Bot[];
  active: RunActivityRow[];
  recent: RunActivityRow[];
};

const EMPTY_PAYLOAD: SpacePayload = { bots: [], active: [], recent: [] };

const SCOPE_KEY = "atlas:cubicle-scope";

async function loadCubicleSpace(spaceId: string): Promise<SpacePayload> {
  const floor = await rpcForSpace(spaceId).runs.floor();
  return { bots: floor.bots, active: floor.active, recent: floor.recent };
}

function initialScope(): "all" | string {
  const selected = selectedSpaceId();
  try {
    const stored = window.localStorage.getItem(SCOPE_KEY);
    if (stored) return stored;
  } catch {
    // Private mode can refuse storage; the selected space is enough.
  }
  return selected ?? "all";
}

function rememberScope(scope: "all" | string) {
  try {
    window.localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    // The tab still changes for this visit.
  }
}

function deskPath(desk: CubicleDesk): string {
  if (desk.run?.groupId) return `/app/g/${desk.run.groupId}`;
  return `/app/${desk.id}`;
}

function zoneLabel(kind: CubicleKind): ReactNode {
  switch (kind) {
    case "waiting":
      return <Trans>Needs you</Trans>;
    case "working":
      return <Trans>In progress</Trans>;
    case "error":
      return <Trans>Needs attention</Trans>;
    case "idle":
      return <Trans>Quiet</Trans>;
  }
}

function botByName(bots: readonly Bot[], name: string): Bot | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  return bots.find((bot) => bot.name === trimmed);
}

function deskTask(desk: CubicleDesk): string {
  if (desk.run) return activityPreview(desk.run);
  return desk.task;
}

function spaceTargets(spaces: SpaceTarget[], selectedId: string | null): SpaceTarget[] {
  if (spaces.length > 0) return spaces;
  if (selectedId) return [{ id: selectedId, name: "" }];
  return [];
}

/** Every space's agents, with a filter for one space or the whole floor. */
export function CubiclePage() {
  const { t } = useLingui();
  const spaces = useOwnSpaces();
  const selectedId = selectedSpaceId();
  const targets = spaceTargets(spaces, selectedId);
  const [scope, setScope] = useState<"all" | string>(initialScope);
  const [showQuiet, setShowQuiet] = useState(false);
  const results = useQueries({
    queries: targets.map((space) => ({
      queryKey: ["cubicle-floor", space.id],
      queryFn: () => loadCubicleSpace(space.id),
      enabled: space.id.length > 0,
      refetchInterval: (query: { state: { error: unknown } }) =>
        query.state.error && !isRetryableError(query.state.error) ? false : 5_000,
      refetchIntervalInBackground: false,
    })),
  });
  const loaded = useMemo(() => {
    return targets.map((space, index) => {
      const result = results[index];
      const payload = result?.data ?? EMPTY_PAYLOAD;
      const floor = cubicleFloor({
        spaceId: space.id,
        spaceName: space.name,
        bots: payload.bots,
        active: payload.active,
        recent: payload.recent,
      });
      return {
        floor,
        bots: payload.bots,
        pending: Boolean(result?.isPending),
        error: result?.error,
      };
    });
  }, [results, targets]);
  const visible =
    scope === "all" || targets.length < 2
      ? loaded
      : loaded.filter((entry) => entry.floor.spaceId === scope);
  const waiting = loaded.reduce((count, entry) => count + entry.floor.waiting, 0);
  const anyDesk = loaded.some((entry) => entry.floor.desks.length > 0);
  const anyExchange = loaded.some((entry) => entry.floor.exchanges.length > 0);
  const pending = loaded.some((entry) => entry.pending);
  const loadError = loaded.find((entry) => entry.error)?.error;
  const loading = pending && !anyDesk && !anyExchange && targets.length > 0;
  useEffect(() => {
    if (scope === "all" || targets.some((space) => space.id === scope)) return;
    const next = selectedId && targets.some((space) => space.id === selectedId) ? selectedId : "all";
    setScope(next);
  }, [scope, selectedId, targets]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "j" && event.key !== "k") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select, [role='tablist']"))
      ) {
        return;
      }
      const cards = [...document.querySelectorAll<HTMLAnchorElement>("[data-cubicle-focus]")];
      if (cards.length === 0) return;
      const current = cards.findIndex((card) => card === document.activeElement);
      const next =
        event.key === "j"
          ? cards[current < 0 ? 0 : Math.min(cards.length - 1, current + 1)]
          : cards[current <= 0 ? 0 : current - 1];
      event.preventDefault();
      next?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const chooseScope = (next: "all" | string) => {
    setScope(next);
    rememberScope(next);
  };
  const currentName =
    targets.find((space) => space.id === selectedId)?.name ||
    (visible.length === 1 ? visible[0]?.floor.spaceName : "");

  return (
    <div
      className="flex h-full min-w-0 flex-col bg-background text-foreground/90"
      data-testid="cubicle-page"
    >
      <header className="app-drag desktop-caption-end border-b border-border px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {desktopBridge() ? <WindowChrome /> : null}
          <Link
            to="/app"
            className="app-no-drag flex shrink-0 items-center gap-0.5 rounded-lg py-1 pe-1.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <ChevronLeft size={16} strokeWidth={1.9} aria-hidden="true" />
            <Trans>Bots</Trans>
          </Link>
          <div className="min-w-0">
            <h1 className="text-heading2 font-semibold">
              <Trans>Cubicle</Trans>
            </h1>
            {targets.length < 2 && currentName ? (
              <p className="text-sm text-muted-foreground">{currentName}</p>
            ) : targets.length > 1 ? (
              <p className="text-sm text-muted-foreground">
                <Trans>{targets.length} spaces</Trans>
              </p>
            ) : null}
          </div>
          {waiting > 0 ? (
            <p className="text-sm text-warning">
              {waiting === 1 ? <Trans>1 needs you</Trans> : <Trans>{waiting} need you</Trans>}
            </p>
          ) : null}
        </div>
        {targets.length > 1 ? (
          <div
            className="app-no-drag mt-3 flex gap-2 overflow-x-auto pb-1"
            role="tablist"
            aria-label={t`Spaces`}
          >
            <SpaceTab
              label={t`All spaces`}
              selected={scope === "all"}
              count={waiting}
              onSelect={() => chooseScope("all")}
            />
            {loaded.map((entry) => (
              <SpaceTab
                key={entry.floor.spaceId}
                label={entry.floor.spaceName || entry.floor.spaceId}
                selected={scope === entry.floor.spaceId}
                count={entry.floor.waiting}
                onSelect={() => chooseScope(entry.floor.spaceId)}
              />
            ))}
          </div>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {loadError && !anyDesk && !anyExchange ? (
          <LoadError
            message={errorText(loadError, t`Could not load agents`)}
            onRetry={() => {
              for (const result of results) void result.refetch();
            }}
          />
        ) : loading ? (
          <Spinner aria-label={t`Loading agents`} />
        ) : !anyDesk && !anyExchange ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No agents</Trans>
          </p>
        ) : (
          visible.map((entry) => (
            <SpaceFloor
              key={entry.floor.spaceId}
              floor={entry.floor}
              bots={entry.bots}
              error={entry.error}
              showQuiet={showQuiet}
              onToggleQuiet={() => setShowQuiet((open) => !open)}
              showHeading={targets.length > 1 && scope === "all"}
              onRetry={() => {
                const index = targets.findIndex((space) => space.id === entry.floor.spaceId);
                const result = results[index];
                if (result) void result.refetch();
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SpaceTab({
  label,
  selected,
  count,
  onSelect,
}: {
  label: string;
  selected: boolean;
  count: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      }`}
      onClick={onSelect}
    >
      <span>{label}</span>
      {count > 0 ? (
        <span
          className={`rounded-full px-1.5 text-xs tabular-nums ${
            selected ? "bg-background text-foreground" : "bg-warning/15 text-warning"
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert">
      <p className="text-sm text-destructive">{message}</p>
      <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
        <Trans>Try again</Trans>
      </Button>
    </div>
  );
}

function SpaceFloor({
  floor,
  bots,
  error,
  showQuiet,
  onToggleQuiet,
  showHeading,
  onRetry,
}: {
  floor: CubicleFloor;
  bots: readonly Bot[];
  error: unknown;
  showQuiet: boolean;
  onToggleQuiet: () => void;
  showHeading: boolean;
  onRetry: () => void;
}) {
  const { t } = useLingui();
  const desksByZone = new Map<CubicleKind, CubicleDesk[]>();
  for (const kind of cubicleZoneOrder()) desksByZone.set(kind, []);
  for (const desk of floor.desks) desksByZone.get(desk.kind)?.push(desk);
  const quiet = desksByZone.get("idle") ?? [];
  if (floor.desks.length === 0 && floor.exchanges.length === 0 && !error) {
    return (
      <p className="text-sm text-muted-foreground">
        {bots.length === 0 ? <Trans>No agents</Trans> : <Trans>All quiet</Trans>}
      </p>
    );
  }
  return (
    <section className="mb-8 last:mb-0" aria-labelledby={`cubicle-space-${floor.spaceId}`}>
      {showHeading ? (
        <h2 id={`cubicle-space-${floor.spaceId}`} className="mb-3 text-base font-semibold">
          {floor.spaceName}
          {floor.waiting > 0 ? (
            <span className="ms-2 text-sm font-normal text-warning">
              {floor.waiting === 1 ? (
                <Trans>1 needs you</Trans>
              ) : (
                <Trans>{floor.waiting} need you</Trans>
              )}
            </span>
          ) : null}
        </h2>
      ) : null}
      {error ? (
        <LoadError message={errorText(error, t`Could not load agents`)} onRetry={onRetry} />
      ) : null}
      {floor.exchanges.length > 0 ? (
        <div className="mb-6">
          <h3 className="mb-2 text-[13px] font-medium text-muted-foreground">
            <Trans>Between agents</Trans>
          </h3>
          <ul className="flex list-none flex-col gap-2">
            {floor.exchanges.map((exchange) => (
              <ExchangeRow
                key={exchange.runId}
                exchange={exchange}
                bots={bots}
                spaceId={floor.spaceId}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {cubicleZoneOrder().map((kind) => {
        const zoneDesks = desksByZone.get(kind) ?? [];
        if (zoneDesks.length === 0) return null;
        if (kind === "idle" && !showQuiet) {
          return (
            <button
              key={kind}
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground"
              onClick={onToggleQuiet}
            >
              <Trans>
                {quiet.length} quiet
              </Trans>
            </button>
          );
        }
        return (
          <div key={kind} className="mb-6 last:mb-0">
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
              {zoneLabel(kind)}
              <span className="tabular-nums">{zoneDesks.length}</span>
              {kind === "idle" ? (
                <button type="button" className="font-normal hover:text-foreground" onClick={onToggleQuiet}>
                  <Trans>Hide</Trans>
                </button>
              ) : null}
            </h3>
            <ul className="grid list-none gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {zoneDesks.map((desk) => (
                <DeskCard
                  key={desk.id}
                  desk={desk}
                  bot={bots.find((item) => item.id === desk.id)}
                  spaceId={floor.spaceId}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function rememberSpace(spaceId: string) {
  if (spaceId) selectSpace(spaceId);
}

function ExchangeRow({
  exchange,
  bots,
  spaceId,
}: {
  exchange: CubicleExchange;
  bots: readonly Bot[];
  spaceId: string;
}) {
  const recipient = bots.find((bot) => bot.id === exchange.botId);
  const sender =
    (exchange.peerBotId ? bots.find((bot) => bot.id === exchange.peerBotId) : undefined) ??
    botByName(bots, exchange.peerName);
  const tone = statusTone(exchange.status, exchange.updatedAt);
  return (
    <li>
      <Link
        to={`/app/${exchange.botId}`}
        data-testid={`cubicle-exchange-${exchange.runId}`}
        data-cubicle-focus=""
        className="flex gap-3 rounded-xl border border-border bg-card p-3 hover:bg-accent"
        onClick={() => rememberSpace(spaceId)}
      >
        <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <BotAvatar
            avatarSet={sender?.avatarSet}
            color={sender?.color ?? DEFAULT_BOT_AVATAR_COLOR}
            identity={sender?.id ?? exchange.peerName}
            size={28}
          />
          <ArrowRight size={14} className="text-muted-foreground" aria-hidden="true" />
          <BotAvatar
            avatarSet={recipient?.avatarSet}
            color={recipient?.color ?? DEFAULT_BOT_AVATAR_COLOR}
            identity={recipient?.id ?? exchange.botId}
            size={28}
            status={exchange.status}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium" dir="auto">
              {exchange.peerName}
              <span className="font-normal text-muted-foreground"> → </span>
              {exchange.botName}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelativeTime(exchange.updatedAt)}
            </span>
          </span>
          {exchange.text ? (
            <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground" dir="auto">
              {exchange.text}
            </span>
          ) : null}
          <span className={`mt-1 block text-xs ${tone}`}>
            {compactRosterStatusLabel(exchange.status)}
          </span>
        </span>
      </Link>
    </li>
  );
}

function DeskCard({
  desk,
  bot,
  spaceId,
}: {
  desk: CubicleDesk;
  bot?: Bot;
  spaceId: string;
}) {
  const label = compactRosterStatusLabel(desk.status);
  const task = deskTask(desk);
  const showTask = task && task !== label;
  const peerName =
    desk.run?.trigger === "bot_message" &&
    desk.run.agentMessage &&
    desk.run.agentMessage.kind !== "unknown"
      ? desk.run.agentMessage.fromBotName.trim()
      : "";
  return (
    <li>
      <Link
        to={deskPath(desk)}
        data-testid={`cubicle-${desk.id}`}
        data-cubicle-focus=""
        data-kind={desk.kind}
        className={`flex min-h-28 flex-col gap-2 rounded-xl border border-border bg-card p-3 text-foreground hover:bg-accent ${
          desk.kind === "waiting"
            ? "ring-1 ring-warning"
            : desk.kind === "error"
              ? "ring-1 ring-destructive"
              : ""
        }`}
        onClick={() => rememberSpace(spaceId)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {bot ? (
            <BotAvatar
              avatarSet={bot.avatarSet}
              color={bot.color}
              identity={bot.id}
              size={32}
              status={desk.status}
            />
          ) : null}
          <span className="min-w-0 truncate font-medium" dir="auto">
            {desk.name}
          </span>
        </span>
        {peerName ? (
          <span className="text-xs text-muted-foreground">
            <Trans>From {peerName}</Trans>
          </span>
        ) : null}
        {label ? <span className={`text-sm ${statusTone(desk.status)}`}>{label}</span> : null}
        {showTask ? (
          <span className="line-clamp-1 text-sm text-muted-foreground" dir="auto">
            {task}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
