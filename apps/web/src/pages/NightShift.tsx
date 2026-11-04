import type {
  AgentTimes,
  NightShiftBot,
  NightShiftLogEntry,
  NightShiftSpan,
  NightShiftTimeline,
} from "@atlas/contracts";
import { AGENT_TIMES_ROUTINE_NAME, AGENT_TIMES_ROUTINE_PROMPT } from "@atlas/contracts";
import { Button, Spinner } from "@atlas/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Moon, Newspaper, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { desktopBridge } from "../lib/desktop";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";
import { NIGHT_SCENE } from "./night-shift-scene";
import { WindowChrome } from "./WindowChrome";

const WINDOW_MS = 24 * 60 * 60_000;
const BUCKET_MINUTES = 15;
const SPEEDS = [1, 4, 40, 120, 240] as const;
/** A compaction shows its bot asleep at the desk for this long. */
const NAP_MS = 10 * 60_000;
const TIMELINE_KEY = ["night-shift", "timeline"] as const;
const AGENT_TIMES_KEY = ["night-shift", "agent-times"] as const;

// Isometric tile size of one desk cell, in SVG units.
const TILE_W = 120;
const TILE_H = 60;

function iso(gx: number, gy: number) {
  return { x: ((gx - gy) * TILE_W) / 2, y: ((gx + gy) * TILE_H) / 2 };
}

function deskCells(count: number) {
  const cols = Math.max(2, Math.ceil(Math.sqrt(count)));
  return Array.from({ length: count }, (_, index) => ({
    gx: (index % cols) * 1.6 + 0.8,
    gy: Math.floor(index / cols) * 1.6 + 0.8,
    cols,
  }));
}

type DeskState = "lit" | "nap" | "idle";

function deskState(
  bot: NightShiftBot,
  at: number,
  now: number,
  spans: NightShiftSpan[],
  naps: NightShiftLogEntry[],
): DeskState {
  if (
    naps.some(
      (nap) =>
        nap.botId === bot.id && at >= Date.parse(nap.at) && at <= Date.parse(nap.at) + NAP_MS,
    )
  ) {
    return "nap";
  }
  const lit = spans.some((span) => {
    if (span.botId !== bot.id) return false;
    const start = Date.parse(span.start);
    const end = span.end ? Date.parse(span.end) : now;
    return at >= start && at <= end;
  });
  return lit ? "lit" : "idle";
}

function Desk({
  bot,
  gx,
  gy,
  state,
  chief,
}: {
  bot: NightShiftBot;
  gx: number;
  gy: number;
  state: DeskState;
  chief: boolean;
}) {
  const { x, y } = iso(gx, gy);
  const accent = bot.color?.split("::")[0] || NIGHT_SCENE.c8B9CF7;
  const top = `${x},${y - 18} ${x + 40},${y + 2} ${x},${y + 22} ${x - 40},${y + 2}`;
  const left = `${x - 40},${y + 2} ${x},${y + 22} ${x},${y + 36} ${x - 40},${y + 16}`;
  const right = `${x + 40},${y + 2} ${x},${y + 22} ${x},${y + 36} ${x + 40},${y + 16}`;
  const screen =
    state === "lit"
      ? NIGHT_SCENE.c9EE6FF
      : state === "nap"
        ? NIGHT_SCENE.c3B3F66
        : NIGHT_SCENE.c262A3D;
  return (
    <g data-testid="night-shift-desk" data-state={state}>
      {state === "lit" ? <ellipse cx={x} cy={y + 8} rx={70} ry={36} fill="url(#ns-glow)" /> : null}
      {chief ? (
        <polygon
          points={`${x},${y - 34} ${x + 62},${y + 0} ${x},${y + 34} ${x - 62},${y + 0}`}
          fill="none"
          stroke={NIGHT_SCENE.cF5C35A}
          strokeOpacity={0.5}
          strokeDasharray="4 4"
        />
      ) : null}
      <polygon points={left} fill={NIGHT_SCENE.c4A3B2F} />
      <polygon points={right} fill={NIGHT_SCENE.c5C4A3B} />
      <polygon points={top} fill={NIGHT_SCENE.c8A6E55} />
      {/* Monitor */}
      <polygon
        points={`${x - 6},${y - 30} ${x + 20},${y - 17} ${x + 20},${y - 1} ${x - 6},${y - 14}`}
        fill={screen}
        stroke={NIGHT_SCENE.c0B0D17}
        strokeWidth={1}
      />
      {/* Bot */}
      <circle
        cx={x - 18}
        cy={y - 14}
        r={11}
        fill={accent}
        stroke={NIGHT_SCENE.c0B0D17}
        strokeWidth={2}
      />
      <text
        x={x - 18}
        y={y - 10}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill={NIGHT_SCENE.c0B0D17}
      >
        {(bot.name.trim()[0] ?? "?").toUpperCase()}
      </text>
      {state === "nap" ? (
        <text x={x - 4} y={y - 32} fontSize={13} fill={NIGHT_SCENE.cC9C6FF} className="ns-zzz">
          z z
        </text>
      ) : null}
      <g transform={`translate(${x - 18}, ${y - 44})`}>
        <rect
          x={-(bot.name.length * 3.4 + 12)}
          y={-10}
          width={bot.name.length * 6.8 + 24}
          height={16}
          rx={8}
          fill={NIGHT_SCENE.c0B0D17}
          fillOpacity={0.85}
        />
        <circle
          cx={-(bot.name.length * 3.4 + 4)}
          cy={-2}
          r={3}
          fill={
            state === "lit"
              ? NIGHT_SCENE.c4ADE80
              : state === "nap"
                ? NIGHT_SCENE.cA78BFA
                : NIGHT_SCENE.c6B7280
          }
        />
        <text x={4} y={2} textAnchor="middle" fontSize={10} fill={NIGHT_SCENE.cE5E7EB}>
          {bot.name}
        </text>
      </g>
    </g>
  );
}

function Office({
  bots,
  at,
  now,
  timeline,
}: {
  bots: NightShiftBot[];
  at: number;
  now: number;
  timeline: NightShiftTimeline;
}) {
  const { t } = useLingui();
  const cells = deskCells(bots.length);
  const cols = cells[0]?.cols ?? 2;
  const rows = Math.max(2, Math.ceil(bots.length / cols));
  const W = cols * 1.6 + 0.2;
  const H = rows * 1.6 + 0.2;
  const corners = [iso(0, 0), iso(W, 0), iso(W, H), iso(0, H)];
  const minX = Math.min(...corners.map((c) => c.x)) - 80;
  const maxX = Math.max(...corners.map((c) => c.x)) + 80;
  const minY = -90;
  const maxY = Math.max(...corners.map((c) => c.y)) + 60;
  const naps = timeline.log.filter((entry) => entry.kind === "nap");
  const wallH = 70;
  const order = bots
    .map((bot, index) => ({ bot, cell: cells[index] ?? { gx: 0, gy: 0 }, index }))
    .sort((a, b) => a.cell.gx + a.cell.gy - (b.cell.gx + b.cell.gy));
  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      className="h-full w-full"
      role="img"
      aria-label={t`Isometric office with one desk per bot`}
    >
      <defs>
        <radialGradient id="ns-glow">
          <stop offset="0%" stopColor={NIGHT_SCENE.cFFD27A} stopOpacity={0.45} />
          <stop offset="100%" stopColor={NIGHT_SCENE.cFFD27A} stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* Back walls */}
      <polygon
        points={`${corners[0]?.x},${corners[0]?.y} ${corners[1]?.x},${corners[1]?.y} ${corners[1]?.x},${(corners[1]?.y ?? 0) - wallH} ${corners[0]?.x},${(corners[0]?.y ?? 0) - wallH}`}
        fill={NIGHT_SCENE.c2A2F4A}
      />
      <polygon
        points={`${corners[0]?.x},${corners[0]?.y} ${corners[3]?.x},${corners[3]?.y} ${corners[3]?.x},${(corners[3]?.y ?? 0) - wallH} ${corners[0]?.x},${(corners[0]?.y ?? 0) - wallH}`}
        fill={NIGHT_SCENE.c232842}
      />
      {/* Floor */}
      <polygon points={corners.map((c) => `${c.x},${c.y}`).join(" ")} fill={NIGHT_SCENE.cC9B79C} />
      {Array.from({ length: Math.ceil(W) + 1 }, (_, i) => {
        const a = iso(i, 0);
        const b = iso(i, H);
        return (
          <line
            key={`x${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={NIGHT_SCENE.cB3A084}
            strokeWidth={1}
          />
        );
      })}
      {Array.from({ length: Math.ceil(H) + 1 }, (_, i) => {
        const a = iso(0, i);
        const b = iso(W, i);
        return (
          <line
            key={`y${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={NIGHT_SCENE.cB3A084}
            strokeWidth={1}
          />
        );
      })}
      {order.map(({ bot, cell, index }) => (
        <Desk
          key={bot.id}
          bot={bot}
          gx={cell.gx}
          gy={cell.gy}
          chief={index === 0}
          state={deskState(bot, at, now, timeline.spans, naps)}
        />
      ))}
    </svg>
  );
}

function useCompact() {
  const { i18n } = useLingui();
  return useMemo(
    () => new Intl.NumberFormat(i18n.locale, { notation: "compact", maximumFractionDigits: 1 }),
    [i18n.locale],
  );
}

function LogLine({ entry, bots }: { entry: NightShiftLogEntry; bots: Map<string, string> }) {
  const { t, i18n } = useLingui();
  const name = (entry.botId && bots.get(entry.botId)) || t`A bot`;
  const detail = entry.detail ?? "";
  const text =
    entry.kind === "shipped"
      ? t`${name} finished a run`
      : entry.kind === "failed"
        ? t`${name} hit an error`
        : entry.kind === "handoff"
          ? detail === "subagent"
            ? t`${name} handed work to a subagent`
            : t`${name} picked up work from another bot`
          : entry.kind === "decided"
            ? t`${name} ran ${detail} without asking`
            : entry.kind === "needed_you"
              ? t`${name} needed you`
              : entry.kind === "nap"
                ? t`${name} napped while its context was compacted`
                : detail
                  ? t`${name} started the routine ${detail}`
                  : t`${name} started a routine`;
  const time = new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(entry.at),
  );
  return (
    <li className="flex gap-2 py-1.5 text-[13px]">
      <span className="w-11 shrink-0 tabular-nums text-muted-foreground">{time}</span>
      <span className="min-w-0 break-words">{text}</span>
    </li>
  );
}

function AgentTimesCard({
  data,
  chief,
  onScheduled,
}: {
  data: AgentTimes | undefined;
  chief: NightShiftBot | undefined;
  onScheduled: () => void;
}) {
  const { t, i18n } = useLingui();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schedule = async () => {
    if (!chief) return;
    setBusy(true);
    setError(null);
    try {
      await rpc.routines.create({
        botId: chief.id,
        name: AGENT_TIMES_ROUTINE_NAME,
        prompt: AGENT_TIMES_ROUTINE_PROMPT,
        crons: ["0 8 * * *"],
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris",
        active: true,
        notify: true,
      });
      onScheduled();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const routine = data?.routine;
  const edition = data?.edition;
  const next = routine?.nextRunAt
    ? new Intl.DateTimeFormat(i18n.locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(routine.nextRunAt),
      )
    : null;
  return (
    <section
      className="rounded-xl border border-border bg-card p-4"
      data-testid="agent-times"
      aria-label={t`The Agent Times`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Newspaper size={18} aria-hidden="true" />
        <h2 className="font-serif text-lg font-semibold">
          <Trans>The Agent Times</Trans>
        </h2>
        <span className="text-sm text-muted-foreground">
          {routine ? (
            routine.active && next ? (
              <Trans>Next edition {next}</Trans>
            ) : (
              <Trans>Paused</Trans>
            )
          ) : (
            <Trans>Morning digest of overnight work, sent to your phone</Trans>
          )}
        </span>
        {!routine && chief ? (
          <Button size="sm" className="ms-auto" disabled={busy} onClick={() => void schedule()}>
            {busy ? <Spinner /> : null}
            <Trans>Schedule daily at 8:00</Trans>
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      {edition ? (
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            {new Intl.DateTimeFormat(i18n.locale, { dateStyle: "full", timeStyle: "short" }).format(
              new Date(edition.publishedAt),
            )}
          </p>
          <div className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-serif text-[15px] leading-relaxed">
            {edition.text}
          </div>
          <Link
            to={`/app/${edition.botId}`}
            className="mt-2 inline-block text-sm text-primary underline"
          >
            <Trans>Open in chat</Trans>
          </Link>
        </div>
      ) : routine ? (
        <p className="mt-2 text-sm text-muted-foreground">
          <Trans>No edition yet. The first one arrives at the next scheduled time.</Trans>
        </p>
      ) : null}
    </section>
  );
}

export function NightShiftPage() {
  const { t, i18n } = useLingui();
  const compact = useCompact();
  const queryClient = useQueryClient();
  const [range] = useState(() => {
    const to = Math.ceil(Date.now() / 60_000) * 60_000;
    return { from: to - WINDOW_MS, to };
  });
  const timeline = useQuery({
    queryKey: [...TIMELINE_KEY, range.from, range.to],
    queryFn: () =>
      rpc.nightShift.timeline({
        from: new Date(range.from).toISOString(),
        to: new Date(range.to).toISOString(),
        bucketMinutes: BUCKET_MINUTES,
      }),
    refetchInterval: 60_000,
  });
  const agentTimes = useQuery({
    queryKey: AGENT_TIMES_KEY,
    queryFn: () => rpc.nightShift.agentTimes(),
  });
  const [at, setAt] = useState(range.to);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(240);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let frame = 0;
    const tick = (stamp: number) => {
      const prev = last.current ?? stamp;
      last.current = stamp;
      setAt((value) => {
        const next = value + (stamp - prev) * speed;
        if (next >= range.to) {
          setPlaying(false);
          return range.to;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, range.to]);

  const data = timeline.data;
  const botNames = useMemo(
    () => new Map(data?.bots.map((bot) => [bot.id, bot.name]) ?? []),
    [data],
  );
  const visibleLog = useMemo(
    () => (data?.log ?? []).filter((entry) => Date.parse(entry.at) <= at).reverse(),
    [data, at],
  );
  const counters = useMemo(() => {
    const out = { shipped: 0, handoffs: 0, decided: 0, tokens: 0 };
    for (const entry of visibleLog) {
      if (entry.kind === "shipped") out.shipped++;
      if (entry.kind === "handoff") out.handoffs++;
      if (entry.kind === "decided") out.decided++;
    }
    for (const bucket of data?.buckets ?? []) {
      if (Date.parse(bucket.start) <= at) out.tokens += bucket.tokens;
    }
    return out;
  }, [visibleLog, data, at]);
  const peak = Math.max(
    1,
    ...(data?.buckets ?? []).map((b) => b.activeRuns + b.shipped + b.decided),
  );
  const clock = new Intl.DateTimeFormat(i18n.locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(at),
  );
  const day = new Intl.DateTimeFormat(i18n.locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(at));
  const hour = new Date(at).getHours();
  const phase =
    hour < 5 || hour >= 23
      ? t`Late night`
      : hour < 9
        ? t`Early morning`
        : hour < 18
          ? t`Daytime`
          : t`Evening`;
  const ticks = Array.from({ length: 9 }, (_, i) => range.from + (i * WINDOW_MS) / 8);

  return (
    <div
      className="flex h-full min-w-0 flex-col bg-background text-foreground/90"
      data-testid="night-shift-page"
    >
      <header className="app-drag desktop-caption-end border-b border-border px-4 py-3 md:px-6">
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
            <h1 className="flex items-center gap-1.5 text-heading2 font-semibold">
              <Moon size={18} aria-hidden="true" />
              <Trans>Night Shift</Trans>
            </h1>
            <p className="text-sm text-muted-foreground">
              <Trans>What your bots did while you were away</Trans>
            </p>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3 md:p-4">
        {timeline.isPending ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner />
          </div>
        ) : timeline.isError || !data ? (
          <p className="text-sm text-destructive">{errorText(timeline.error)}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row">
              <div
                style={{ background: NIGHT_SCENE.c14172A }}
                className="relative min-h-[320px] flex-1 overflow-hidden rounded-xl border border-border lg:min-h-[460px]"
              >
                <div className="absolute start-3 top-3 z-10 rounded-lg bg-black/50 px-3 py-2 text-white">
                  <div className="text-3xl font-bold tabular-nums">{clock}</div>
                  <div className="text-xs text-white/70">
                    {day} ? {phase}
                  </div>
                </div>
                <div className="absolute end-3 top-3 z-10 flex flex-col items-end gap-1 text-xs text-white">
                  <span className="rounded-full bg-black/50 px-2.5 py-1">
                    <Trans>{counters.shipped} shipped</Trans>
                  </span>
                  <span className="rounded-full bg-black/50 px-2.5 py-1">
                    <Trans>{counters.handoffs} handoffs</Trans>
                  </span>
                  <span className="rounded-full bg-black/50 px-2.5 py-1">
                    <Trans>{counters.decided} decided without you</Trans>
                  </span>
                  <span className="rounded-full bg-black/50 px-2.5 py-1">
                    <Trans>{compact.format(counters.tokens)} tokens</Trans>
                  </span>
                </div>
                {data.bots.length === 0 ? (
                  <p className="p-6 pt-24 text-sm text-white/70">
                    <Trans>No bots yet.</Trans>
                  </p>
                ) : (
                  <Office bots={data.bots} at={at} now={Date.now()} timeline={data} />
                )}
              </div>
              <aside className="flex max-h-[460px] min-h-0 w-full flex-col rounded-xl border border-border bg-card lg:w-80">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h2 className="text-sm font-semibold">
                    <Trans>Night log</Trans>
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {visibleLog.length === 1 ? (
                      <Trans>1 event</Trans>
                    ) : (
                      <Trans>{visibleLog.length} events</Trans>
                    )}
                  </span>
                </div>
                <ul className="min-h-0 flex-1 overflow-auto px-3" data-testid="night-log">
                  {visibleLog.length === 0 ? (
                    <li className="py-3 text-sm text-muted-foreground">
                      <Trans>Nothing happened yet at this time.</Trans>
                    </li>
                  ) : (
                    visibleLog.map((entry, index) => (
                      <LogLine
                        key={`${entry.at}-${entry.kind}-${index}`}
                        entry={entry}
                        bots={botNames}
                      />
                    ))
                  )}
                </ul>
                {data.truncated ? (
                  <p className="border-t border-border px-3 py-1.5 text-xs text-warning">
                    <Trans>Busy night: some rows were left out, so counts are a minimum.</Trans>
                  </p>
                ) : null}
              </aside>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-3 py-2">
              <Button
                size="icon"
                variant="secondary"
                aria-label={playing ? t`Pause` : t`Play`}
                onClick={() => {
                  if (!playing && at >= range.to) setAt(range.from);
                  setPlaying(!playing);
                }}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </Button>
              <div className="relative min-w-[200px] flex-1">
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-5 flex h-5 items-end gap-px"
                  aria-hidden="true"
                >
                  {data.buckets.map((bucket) => (
                    <div
                      key={bucket.start}
                      className="flex-1 rounded-sm bg-primary/40"
                      style={{
                        height: `${((bucket.activeRuns + bucket.shipped + bucket.decided) / peak) * 100}%`,
                      }}
                    />
                  ))}
                </div>
                <input
                  type="range"
                  min={range.from}
                  max={range.to}
                  step={60_000}
                  value={at}
                  aria-label={t`Time of day`}
                  className="mt-6 w-full accent-primary"
                  onChange={(event) => {
                    setPlaying(false);
                    setAt(Number(event.target.value));
                  }}
                />
                <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
                  {ticks.map((tick) => (
                    <span key={tick}>
                      {new Intl.DateTimeFormat(i18n.locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(tick))}
                    </span>
                  ))}
                </div>
              </div>
              <fieldset className="flex gap-1 border-0 p-0" aria-label={t`Playback speed`}>
                {SPEEDS.map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={speed === value ? "default" : "ghost"}
                    aria-pressed={speed === value}
                    onClick={() => setSpeed(value)}
                  >
                    {value}x
                  </Button>
                ))}
              </fieldset>
            </div>
            <AgentTimesCard
              data={agentTimes.data}
              chief={data.bots[0]}
              onScheduled={() => void queryClient.invalidateQueries({ queryKey: AGENT_TIMES_KEY })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
