import type { Bot, Routine } from "@atlas/contracts";
import { ROUTINE_MENTION_BATCH_MAX } from "@atlas/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@atlas/ui-web";
import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Clock, Pause } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { takeInitialBootstrap } from "../lib/bootstrap";
import { cronLabels } from "../lib/cron";
import { desktopBridge } from "../lib/desktop";
import { useSpaceQueries } from "../lib/query";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { routineTriggerSummary } from "./RoutineEditor";
import { WindowChrome } from "./WindowChrome";

const NO_BOTS: Bot[] = [];
export const ROUTINES_OVERVIEW_KEY = ["routines-overview"] as const;

export type RoutineOverviewRow = { bot: Bot; routine: Routine };

/** Every routine across the given bots, soonest next run first; paused and unscheduled ones last. */
export async function loadRoutineOverview(bots: Bot[]): Promise<RoutineOverviewRow[]> {
  const byId = new Map(bots.map((bot) => [bot.id, bot]));
  const rows: RoutineOverviewRow[] = [];
  for (let start = 0; start < bots.length; start += ROUTINE_MENTION_BATCH_MAX) {
    const botIds = bots.slice(start, start + ROUTINE_MENTION_BATCH_MAX).map((bot) => bot.id);
    for (const group of await rpc.routines.listForMentions({ botIds })) {
      const bot = byId.get(group.botId);
      if (bot) for (const routine of group.routines) rows.push({ bot, routine });
    }
  }
  return rows.sort(compareRows);
}

function compareRows(a: RoutineOverviewRow, b: RoutineOverviewRow): number {
  const next = (row: RoutineOverviewRow) =>
    row.routine.active && row.routine.nextRunAt
      ? Date.parse(row.routine.nextRunAt)
      : Number.POSITIVE_INFINITY;
  const byNext = next(a) - next(b);
  if (byNext !== 0 && !Number.isNaN(byNext)) return byNext;
  return a.bot.name.localeCompare(b.bot.name) || a.routine.name.localeCompare(b.routine.name);
}

export function formatRunTime(iso: string | null, locale: string): string {
  if (!iso) return "\u2014";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "\u2014";
  return date.toLocaleString(locale || "en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RoutinesPage() {
  const { i18n } = useLingui();
  const navigate = useNavigate();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const bots =
    useQuery({
      queryKey: queries.bootstrap.queryKey({ input: {} }),
      queryFn: () => takeInitialBootstrap(),
      select: (bootstrap) => bootstrap.bots,
    }).data ?? NO_BOTS;
  const overview = useQuery({
    queryKey: [...ROUTINES_OVERVIEW_KEY, bots.map((bot) => bot.id)],
    queryFn: () => loadRoutineOverview(bots),
    enabled: bots.length > 0,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<RoutineOverviewRow | null>(null);
  const labels = cronLabels(i18n.locale);
  const rows = overview.data ?? [];

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ROUTINES_OVERVIEW_KEY });
  }

  async function setActive(routine: Routine, active: boolean) {
    setBusyId(routine.id);
    setError(null);
    try {
      await rpc.routines.update({ routineId: routine.id, active });
      await refresh();
    } catch (err) {
      setError(
        errorText(err, active ? t`Could not resume this routine` : t`Could not pause this routine`),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusyId(pendingDelete.routine.id);
    setError(null);
    try {
      await rpc.routines.remove({ routineId: pendingDelete.routine.id });
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      setError(errorText(err, t`Could not delete this routine`));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-background text-foreground/90">
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
            <Trans>Routines</Trans>
          </h1>
        </div>
      </header>
      {error ? (
        <p role="alert" className="px-6 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {overview.isPending && bots.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Loading routines?</Trans>
          </p>
        ) : overview.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorText(overview.error, t`Could not load routines`)}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              No routines yet. Ask a bot to remind you or to do something on a schedule.
            </Trans>
          </p>
        ) : (
          <table data-testid="routines-overview" className="w-full text-start text-[13.5px]">
            <thead className="text-[12.5px] text-muted-foreground">
              <tr>
                <th className="py-2 text-start font-medium">
                  <Trans>Routine</Trans>
                </th>
                <th className="py-2 text-start font-medium">
                  <Trans>Bot</Trans>
                </th>
                <th className="py-2 text-start font-medium">
                  <Trans>Next run</Trans>
                </th>
                <th className="py-2 text-start font-medium">
                  <Trans>Last run</Trans>
                </th>
                <th className="py-2 text-end font-medium">
                  <span className="sr-only">
                    <Trans>Actions</Trans>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ bot, routine }) => {
                const editable = routine.editable !== false;
                const busy = busyId === routine.id;
                return (
                  <tr
                    key={routine.id}
                    data-routine-id={routine.id}
                    className="border-t border-border"
                  >
                    <td className="py-2.5 pe-3">
                      <div className="flex items-center gap-2">
                        {routine.active ? (
                          <Clock size={15} strokeWidth={1.6} className="text-success" aria-hidden />
                        ) : (
                          <Pause size={13} className="text-muted-foreground" aria-hidden />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground" dir="auto">
                            {routine.name}
                          </div>
                          <div className="truncate text-[12.5px] text-muted-foreground/80">
                            {routineTriggerSummary(routine, labels)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pe-3" dir="auto">
                      {bot.name}
                    </td>
                    <td className="py-2.5 pe-3 whitespace-nowrap">
                      {routine.active ? formatRunTime(routine.nextRunAt, i18n.locale) : t`Paused`}
                    </td>
                    <td className="py-2.5 pe-3 whitespace-nowrap">
                      {formatRunTime(routine.lastRunAt, i18n.locale)}
                    </td>
                    <td className="py-2.5">
                      <div className="flex justify-end gap-1.5">
                        {editable ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => void setActive(routine, !routine.active)}
                          >
                            {routine.active ? <Trans>Pause</Trans> : <Trans>Resume</Trans>}
                          </Button>
                        ) : null}
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() =>
                            navigate(`/app/${bot.id}?routine=${encodeURIComponent(routine.id)}`)
                          }
                        >
                          {editable ? <Trans>Edit</Trans> : <Trans>Open</Trans>}
                        </Button>
                        {editable ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-destructive"
                            disabled={busy}
                            onClick={() => setPendingDelete({ bot, routine })}
                          >
                            <Trans>Delete</Trans>
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {pendingDelete ? (
        <AlertDialog open onOpenChange={(open) => (open ? undefined : setPendingDelete(null))}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                <Trans>Delete {pendingDelete.routine.name}?</Trans>
              </AlertDialogTitle>
              <AlertDialogDescription>
                <Trans>{pendingDelete.bot.name} stops running it. This can't be undone.</Trans>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busyId !== null}>
                <Trans>Cancel</Trans>
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busyId !== null}
                onClick={() => void confirmDelete()}
              >
                <Trans>Delete</Trans>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
