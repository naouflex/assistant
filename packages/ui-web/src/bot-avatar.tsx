import type { BotAvatarSet } from "@atlas/contracts";
import type { BotColorDef, LogoAvatarActivity } from "@atlas/core";
import {
  ACTIVE_RUN_STATUSES,
  avatarIdentitySeed,
  BOT_AVATAR_COLORS,
  BOT_COLOR_LIST,
  contrastRatio,
  DEFAULT_BOT_AVATAR_COLOR,
  organicAvatarPath,
  resolvePersonaColorDef,
  SHIPPED_BOT_AVATAR_CENTER,
  SHIPPED_BOT_AVATAR_SHAPE_KEYS,
  SHIPPED_BOT_AVATAR_SHAPES,
  SHIPPED_BOT_AVATAR_VIEWBOX,
  shippedBotAvatarGoggles,
  shippedBotAvatarShapePath,
} from "@atlas/core";
import { tokens } from "@atlas/ui-tokens";
import type { CSSProperties } from "react";
import { memo, useId, useMemo, useSyncExternalStore } from "react";
import { useBotAvatarActivity } from "./bot-avatar-activity.js";
import { cn } from "./lib/utils.js";
import { LogoAvatar } from "./logo-avatar.js";
import "./styles.css";

export type { BotColorDef };
export { BOT_AVATAR_COLORS, BOT_COLOR_LIST, DEFAULT_BOT_AVATAR_COLOR, resolvePersonaColorDef };

export const BOT_SHAPES = SHIPPED_BOT_AVATAR_SHAPES;
export const SHIPPED_SHAPE_KEYS = SHIPPED_BOT_AVATAR_SHAPE_KEYS;
const VIEWBOX = SHIPPED_BOT_AVATAR_VIEWBOX;
const CENTER = SHIPPED_BOT_AVATAR_CENTER;
/** Organic eyes are 7×24 pills in a 120-unit box; scale into the shape viewBox. */
const SHAPE_EYE_SCALE = 229 / 120;
const SHAPE_EYE_W = 7 * SHAPE_EYE_SCALE;
const SHAPE_EYE_H = 24 * SHAPE_EYE_SCALE;
const SHAPE_EYE_OFFSET_X = 10.5 * SHAPE_EYE_SCALE;

export const BOT_MASCOT_SHAPES = SHIPPED_SHAPE_KEYS.map(
  (k) => BOT_SHAPES[k] ?? FALLBACK_SHAPE_PATH,
);

const FALLBACK_SHAPE_PATH = BOT_SHAPES.hex ?? "";

export function parseBotAvatar(
  rawColor: string,
  _identity?: string,
): {
  color: string;
  shapeIndex?: number;
  isImage: boolean;
  imageUrl?: string;
} {
  if (!rawColor) return { color: "#F97316", isImage: false };
  // Only data: image URLs are rendered. Arbitrary http(s)/blob values in `color`
  // must not become <img src> (SSRF / tracking when other members view the bot).
  if (rawColor.startsWith("data:image/")) {
    return { color: "#F97316", isImage: true, imageUrl: rawColor };
  }
  if (rawColor.includes("::shape_")) {
    const parts = rawColor.split("::shape_");
    const rawShapeIdx = parts[1] ?? "0";
    const parsedShapeIdx = /^\d+$/.test(rawShapeIdx) ? Number(rawShapeIdx) : 0;
    const shapeIdx = Number.isSafeInteger(parsedShapeIdx) ? parsedShapeIdx : 0;
    return {
      color: parts[0] || "#F97316",
      shapeIndex: shapeIdx % SHIPPED_SHAPE_KEYS.length,
      isImage: false,
    };
  }
  return { color: rawColor, isImage: false };
}

const AVATAR_HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function defaultBotAvatarValue(rawColor: string): string {
  const parsed = parseBotAvatar(rawColor);
  if (rawColor && !parsed.isImage && AVATAR_HEX.test(parsed.color)) return parsed.color;
  return DEFAULT_BOT_AVATAR_COLOR;
}

export interface BotAvatarProps {
  color: string;
  avatarSet?: BotAvatarSet;
  activity?: LogoAvatarActivity;
  size?: number;
  status?: string;
  identity?: string;
  className?: string;
}

export const BotAvatar = memo(function BotAvatar({
  color,
  avatarSet,
  activity,
  size = 36,
  status,
  identity = "",
  className,
}: BotAvatarProps) {
  const id = useId().replace(/[^a-zA-Z0-9-_]/g, "");
  const parsed = useMemo(() => parseBotAvatar(color, identity), [color, identity]);
  const effectiveId = identity || parsed.color || "agent";
  const liveActivity = useBotAvatarActivity(effectiveId, status);
  const resolvedActivity = activity ?? liveActivity;
  const isWorking =
    (resolvedActivity !== "idle" && resolvedActivity !== "error") ||
    (activity === undefined && ACTIVE_RUN_STATUSES.some((runStatus) => runStatus === status));

  const colorDef = useMemo(
    () => resolvePersonaColorDef(effectiveId, parsed.color),
    [effectiveId, parsed.color],
  );

  if (parsed.isImage && parsed.imageUrl) {
    const goggles = shippedBotAvatarGoggles(parsed.imageUrl);
    return (
      <div
        className={cn("atlas-bot-avatar relative shrink-0 select-none", className)}
        data-working={isWorking}
        style={{ width: size, height: size }}
      >
        <div className="atlas-bot-avatar-picture relative size-full">
          <div className="atlas-bot-avatar-picture-face relative size-full">
            <img
              src={parsed.imageUrl}
              alt=""
              className="atlas-bot-avatar-picture-body size-full object-contain"
              draggable={false}
            />
            {goggles ? (
              <img
                src={goggles}
                alt=""
                className="atlas-bot-avatar-picture-goggles pointer-events-none absolute inset-0 size-full object-contain"
                draggable={false}
                aria-hidden="true"
              />
            ) : null}
          </div>
        </div>
        {isWorking ? <WorkingRing size={size} /> : null}
      </div>
    );
  }

  if (parsed.shapeIndex === undefined && avatarSet === "atlas") {
    return (
      <div
        className={cn("atlas-bot-avatar relative inline-flex shrink-0", className)}
        style={{ width: size, height: size }}
      >
        <LogoAvatar
          avatarValue={color ? colorDef.hex : undefined}
          identity={effectiveId}
          size={size}
          activity={resolvedActivity}
        />
        {isWorking ? <WorkingRing size={size} /> : null}
      </div>
    );
  }
  if (parsed.shapeIndex === undefined) {
    return (
      <div
        className={cn("atlas-bot-avatar relative inline-flex shrink-0", className)}
        style={{ width: size, height: size }}
      >
        <OrganicAvatar
          color={colorDef.hex}
          identity={effectiveId}
          size={size}
          isWorking={isWorking}
        />
        {isWorking ? <WorkingRing size={size} /> : null}
      </div>
    );
  }

  return (
    <ShippedShapeAvatar
      id={id}
      color={colorDef}
      shapeIndex={parsed.shapeIndex}
      identity={effectiveId}
      size={size}
      isWorking={isWorking}
      className={className}
    />
  );
});

/** Studio shapes share organic eye/body CSS so web matches mobile's living shapes. */
function ShippedShapeAvatar({
  id,
  color,
  shapeIndex,
  identity,
  size,
  isWorking,
  className,
}: {
  id: string;
  color: BotColorDef;
  shapeIndex: number;
  identity: string;
  size: number;
  isWorking: boolean;
  className?: string;
}) {
  const seed = avatarIdentitySeed(identity || color.hex || DEFAULT_BOT_AVATAR_COLOR);
  const path = shippedBotAvatarShapePath(shapeIndex);
  const pale = contrastRatio(color.hex, "#FFFFFF") < 1.15;

  return (
    <div
      className={cn(
        "atlas-bot-avatar bot-avatar-container relative inline-flex items-center justify-center shrink-0 select-none",
        className,
      )}
      style={{ width: size, height: size }}
      data-working={isWorking}
    >
      <svg
        className="atlas-bot-avatar-ring absolute pointer-events-none"
        style={{
          inset: -4,
          width: size + 8,
          height: size + 8,
          filter: `drop-shadow(0 0 6px ${color.light}) drop-shadow(0 0 10px #ffffff)`,
        }}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="24"
          cy="24"
          r="22"
          stroke={`url(#${id}-ring)`}
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeDasharray="45 80"
        />
        <circle cx="43" cy="24" r="2.8" fill="#ffffff" />
        <defs>
          <linearGradient id={`${id}-ring`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="60%" stopColor={color.light} stopOpacity="0.9" />
            <stop offset="100%" stopColor={color.light} stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <svg
        viewBox={VIEWBOX}
        aria-hidden="true"
        className="atlas-organic-avatar atlas-shape-avatar overflow-visible select-none"
        data-working={isWorking}
        data-shape-family={seed % 10}
        data-eye-pattern={seed % 4}
        style={{
          width: size,
          height: size,
          filter: isWorking
            ? `drop-shadow(0 0 8px ${color.light}) drop-shadow(0 0 2px #ffffff)`
            : "drop-shadow(0 2px 4px rgba(0,0,0,0.45))",
        }}
      >
        <defs>
          <linearGradient id={`bot-ink-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color.light} />
            <stop offset="100%" stopColor={color.dark} />
          </linearGradient>
        </defs>
        {(["idle", "working"] as const).map((mode) => (
          <path
            key={mode}
            className={`atlas-organic-avatar-body atlas-organic-avatar-body-${mode}`}
            d={path}
            fill={`url(#bot-ink-${id})`}
            stroke={pale ? "rgba(20,20,20,0.28)" : undefined}
            strokeWidth={pale ? 6 : undefined}
            style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}
          />
        ))}
        {/* Same pill eyes as OrganicAvatar, scaled into the shape viewBox. */}
        <g transform={`rotate(${(seed % 9) - 4} ${CENTER} ${CENTER})`}>
          {(["idle", "working"] as const).map((mode) => (
            <g
              key={mode}
              className={`atlas-organic-avatar-eyes atlas-organic-avatar-eyes-${mode} bot-character-eyes`}
              fill={pale ? "#141414" : tokens.background}
            >
              <rect
                x={CENTER - SHAPE_EYE_OFFSET_X - SHAPE_EYE_W / 2}
                y={CENTER - SHAPE_EYE_H / 2 - 8}
                width={SHAPE_EYE_W}
                height={SHAPE_EYE_H}
                rx={SHAPE_EYE_W / 2}
              />
              <rect
                x={CENTER + SHAPE_EYE_OFFSET_X - SHAPE_EYE_W / 2}
                y={CENTER - SHAPE_EYE_H / 2 - 8}
                width={SHAPE_EYE_W}
                height={SHAPE_EYE_H}
                rx={SHAPE_EYE_W / 2}
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}

/** The same spinning ring Chief's photo uses, for every working bot. */
function WorkingRing({ size }: { size: number }) {
  return (
    <svg
      className="atlas-bot-avatar-ring atlas-bot-avatar-ring-working absolute pointer-events-none"
      style={{ inset: -4, width: size + 8, height: size + 8 }}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="24"
        cy="24"
        r="22"
        className="stroke-status-working"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeDasharray="45 80"
      />
    </svg>
  );
}

function OrganicAvatar({
  color,
  identity,
  size,
  isWorking,
  className,
}: {
  color: string;
  identity?: string;
  size: number;
  isWorking: boolean;
  className?: string;
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
  const seed = avatarIdentitySeed(identity || color || DEFAULT_BOT_AVATAR_COLOR);
  const duration = `${4.8 + (seed % 24) / 10}s`;
  const shapeA = organicAvatarPath(seed);
  const shapeB = organicAvatarPath(seed, 0.42);
  const pale = contrastRatio(color, "#FFFFFF") < 1.15;

  return (
    <svg
      viewBox="-60 -60 120 120"
      aria-hidden="true"
      className={cn("atlas-organic-avatar overflow-visible select-none", className)}
      data-working={isWorking}
      data-shape-family={seed % 10}
      data-eye-pattern={seed % 4}
      style={{
        width: size,
        height: size,
        flex: "none",
      }}
    >
      {(["idle", "working"] as const).map((mode) => (
        <path
          key={mode}
          className={`atlas-organic-avatar-body atlas-organic-avatar-body-${mode}`}
          d={shapeA}
          fill={color}
          stroke={pale ? "rgba(20,20,20,0.28)" : undefined}
          strokeWidth={pale ? 3.5 : undefined}
          style={
            {
              "--atlas-organic-path": `path("${shapeA}")`,
              filter:
                mode === "working"
                  ? `drop-shadow(0 0 ${Math.round(size * 0.16)}px ${color})`
                  : "drop-shadow(0 2px 3px rgba(0,0,0,.34))",
            } as CSSProperties
          }
        >
          {!reducedMotion ? (
            <animate
              attributeName="d"
              values={`${shapeA};${shapeB};${shapeA}`}
              dur={duration}
              repeatCount="indefinite"
            />
          ) : null}
        </path>
      ))}
      <g transform={`rotate(${(seed % 9) - 4})`}>
        {(["idle", "working"] as const).map((mode) => (
          <g
            key={mode}
            className={`atlas-organic-avatar-eyes atlas-organic-avatar-eyes-${mode}`}
            fill={pale ? "#141414" : tokens.background}
          >
            <rect x="-14" y="-12" width="7" height="24" rx="3.5" />
            <rect x="7" y="-12" width="7" height="24" rx="3.5" />
          </g>
        ))}
      </g>
    </svg>
  );
}

const reducedMotionMedia = "(prefers-reduced-motion: reduce)";

function reducedMotionSnapshot(): boolean {
  return window.matchMedia(reducedMotionMedia).matches;
}

function subscribeToReducedMotion(onChange: () => void): () => void {
  const media = window.matchMedia(reducedMotionMedia);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function BotShapePreview({
  shapeIndex,
  identity,
  label,
  color,
  selected,
  onClick,
}: {
  /** An Avatar Studio shape; omit it to draw the organic body `identity` gets. */
  shapeIndex?: number;
  identity?: string;
  label?: string;
  color: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const key =
    shapeIndex === undefined
      ? undefined
      : (SHIPPED_SHAPE_KEYS[shapeIndex % SHIPPED_SHAPE_KEYS.length] ?? "hex");
  const previewColor =
    shapeIndex === undefined ? color : `${color}::shape_${shapeIndex % SHIPPED_SHAPE_KEYS.length}`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? key}
      aria-pressed={selected ?? false}
      className={cn(
        "relative flex size-11 items-center justify-center rounded-xl transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
        selected
          ? "ring-2 ring-primary ring-offset-2 ring-offset-popover bg-white/10"
          : "hover:bg-white/5",
      )}
    >
      <BotAvatar color={previewColor} identity={identity ?? "preview"} size={32} />
    </button>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex h-11 w-11 items-center justify-center gap-1.5 rounded-full bg-card">
        <span className="h-4 w-[7px] rounded-full bg-primary" />
        <span className="h-4 w-[7px] rounded-full bg-primary" />
      </div>
      <span className="font-[Aeonik,ui-sans-serif] text-[28px] tracking-tight text-foreground">
        Atlas
      </span>
    </div>
  );
}
