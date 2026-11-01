import type { Bot } from "@atlas/contracts";
import { isRetryableError } from "@atlas/core";
import { BotAvatar, Button, Spinner } from "@atlas/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { desktopBridge } from "../lib/desktop";
import { useSpaceQueries } from "../lib/query";
import { compactRosterStatusLabel } from "../lib/roster-status";
import { errorText } from "../lib/user-error";
import { statusTone } from "./ActivityList";
import { cubicleDesks } from "./cubicle";
import { WindowChrome } from "./WindowChrome";

const NO_BOTS: Bot[] = [];

/** A floor of desks for the space's agents: who is working, who needs you, who failed. */
export function CubiclePage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const poll = {
    refetchInterval: (query: { state: { error: unknown } }) =>
      query.state.error && !isRetryableError(query.state.error) ? false : 5_000,
  } as const;
  const botsQuery = useQuery({ ...queries.bots.list.queryOptions(), ...poll });
  const runsQuery = useQuery({
    ...queries.runs.list.queryOptions({ input: { filter: "active" } }),
    ...poll,
  });
  const bots = botsQuery.data ?? NO_BOTS;
  const desks = cubicleDesks(bots, runsQuery.data?.runs ?? []);
  const waiting = desks.filter((desk) => desk.kind === "waiting").length;
  const loadError = botsQuery.error ?? runsQuery.error;
  const loading = (botsQuery.isPending || runsQuery.isPending) && desks.length === 0;

  return (
    <div
      className="flex h-full min-w-0 flex-col bg-background text-foreground/90"
      data-testid="cubicle-page"
    >
      <header className="app-drag desktop-caption-end border-b border-border px-4 py-4 md:px-6">
        <div className="flex items-center gap-2">
          {desktopBridge() ? <WindowChrome /> : null}
          <Link
            to="/app"
            className="app-no-drag flex shrink-0 items-center gap-0.5 rounded-lg py-1 pe-1.5 text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <ChevronLeft size={16} strokeWidth={1.9} aria-hidden="true" />
            <Trans>Bots</Trans>
          </Link>
          <h1 className="text-heading2 font-semibold">
            <Trans>Cubicle</Trans>
          </h1>
          {waiting > 0 ? (
            <p className="text-sm text-warning">
              {waiting === 1 ? <Trans>1 needs you</Trans> : <Trans>{waiting} need you</Trans>}
            </p>
          ) : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {loadError && desks.length === 0 ? (
          <div role="alert">
            <p className="text-sm text-destructive">
              {errorText(loadError, t`Could not load agents`)}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => {
                void botsQuery.refetch();
                void runsQuery.refetch();
              }}
            >
              <Trans>Try again</Trans>
            </Button>
          </div>
        ) : loading ? (
          <Spinner aria-label={t`Loading agents`} />
        ) : desks.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No agents</Trans>
          </p>
        ) : (
          <>
            {loadError ? (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {errorText(loadError, t`Could not load agents`)}
              </p>
            ) : null}
            <ul className="grid list-none gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {desks.map((desk) => {
                const bot = bots.find((item) => item.id === desk.id);
                const label = compactRosterStatusLabel(desk.status);
                const task = desk.task && desk.task !== label ? desk.task : "";
                return (
                  <li key={desk.id}>
                    <Link
                      to={`/app/${desk.id}`}
                      data-testid={`cubicle-${desk.id}`}
                      data-kind={desk.kind}
                      className={`flex min-h-28 flex-col gap-2 rounded-xl border border-border bg-card p-3 text-foreground hover:bg-accent ${
                        desk.kind === "waiting"
                          ? "ring-1 ring-warning"
                          : desk.kind === "error"
                            ? "ring-1 ring-destructive"
                            : ""
                      }`}
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
                      {label ? (
                        <span className={`text-sm ${statusTone(desk.status)}`}>{label}</span>
                      ) : null}
                      {task ? (
                        <span className="line-clamp-2 text-sm text-muted-foreground" dir="auto">
                          {task}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
