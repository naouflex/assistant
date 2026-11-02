import type { BotAvatarSet } from "@atlas/contracts";
import { AVATAR_WORD_MAX_LENGTH, botAvatarWordValue, resolveBotAvatarSet } from "@atlas/contracts";
import { SHIPPED_BOT_AVATAR_IMAGES, SHIPPED_BOT_AVATAR_SHAPE_KEYS } from "@atlas/core";
import {
  BOT_AVATAR_COLORS,
  BotAvatar,
  BotShapePreview,
  DEFAULT_BOT_AVATAR_COLOR,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  defaultBotAvatarValue,
  Input,
  parseBotAvatar,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@atlas/ui-web";
import { Button } from "@atlas/ui-web/components/ui/button";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Check, Pencil, Upload, X } from "lucide-react";
import type { ClipboardEvent, DragEvent } from "react";
import { useEffect, useRef, useState } from "react";

/** Near-white swatches need a harder edge so they stay clickable on light popovers. */
function avatarPictureKey(value: string): string {
  const parsed = parseBotAvatar(value);
  if (parsed.isImage) return "image";
  if (parsed.word) return `word:${parsed.word}`;
  if (parsed.shapeIndex !== undefined) return `shape:${parsed.shapeIndex}`;
  return "default";
}

/** Studio shapes and word icons render on the Original set, not the Atlas logo. */
function studioPreviewAvatarSet(
  value: string,
  pendingLook: string | null | undefined,
  avatarSet: BotAvatarSet,
): BotAvatarSet {
  const parsed = parseBotAvatar(pendingLook ?? value);
  if (parsed.shapeIndex !== undefined || parsed.word) return "organic";
  return avatarSet;
}

function avatarValueForIconSet(nextSet: BotAvatarSet, value: string): string {
  if (nextSet === "organic") return value;
  const parsed = parseBotAvatar(value);
  if (parsed.isImage) return value;
  return parsed.color || DEFAULT_BOT_AVATAR_COLOR;
}

function isPaleAvatarSwatch(color: string): boolean {
  const hex = color.replace("#", "");
  const full =
    hex.length === 3
      ? [...hex].map((part) => `${part}${part}`).join("")
      : hex.padStart(6, "0").slice(0, 6);
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) return false;
  return (r * 299 + g * 587 + b * 114) / 1000 > 230;
}

/**
 * The shape grid and color row for a bot's look. With `organicIdentities`, the grid also offers
 * the organic body each identity draws (for a bot that has no id yet); without them, "Default"
 * restores the bot's own organic body.
 */
export function BotLookPicker({
  value,
  identity,
  organicIdentities,
  avatarSet = "organic",
  onAvatarSetChange,
  onChange,
  onPreviewChange,
}: {
  value: string;
  identity?: string;
  organicIdentities?: readonly string[];
  avatarSet?: BotAvatarSet;
  onAvatarSetChange?: (set: BotAvatarSet, value: string) => void;
  onChange: (value: string, identity?: string) => void;
  /** The picture a typed word would save, before Apply commits it. */
  onPreviewChange?: (value: string | null) => void;
}) {
  const parsed = parseBotAvatar(value);
  const currentColor = parsed.color || DEFAULT_BOT_AVATAR_COLOR;
  const isDefaultLook = !parsed.isImage && parsed.shapeIndex === undefined && !parsed.word;
  const picture = avatarPictureKey(value);
  const [wordDraft, setWordDraft] = useState<string | null>(null);
  const [draftPicture, setDraftPicture] = useState<string | null>(null);
  const draftStale = wordDraft !== null && draftPicture !== picture;
  if (draftStale) {
    setWordDraft(null);
    setDraftPicture(null);
  }
  const wordShown = draftStale ? (parsed.word ?? "") : (wordDraft ?? parsed.word ?? "");
  const wordPreview = botAvatarWordValue(currentColor, wordShown);
  const wordIsPicture = Boolean(parsed.word) && wordDraft === null;
  const pending =
    !draftStale && wordDraft !== null && wordPreview && wordPreview !== value ? wordPreview : null;

  useEffect(() => {
    onPreviewChange?.(pending);
    return () => onPreviewChange?.(null);
  }, [onPreviewChange, pending]);

  function editWord(next: string) {
    setDraftPicture(picture);
    setWordDraft(next);
  }

  function commitLook(next: string, nextIdentity?: string) {
    const parsedNext = parseBotAvatar(next);
    if (parsedNext.isImage) {
      onChange(next, nextIdentity);
      return;
    }
    const needsOriginal =
      avatarSet !== "organic" &&
      (parsedNext.shapeIndex !== undefined ||
        parsedNext.word !== undefined ||
        (nextIdentity !== undefined && parsedNext.shapeIndex === undefined && !parsedNext.word));
    if (needsOriginal) {
      onAvatarSetChange?.("organic", next);
      return;
    }
    onChange(next, nextIdentity);
  }

  function selectColor(color: string) {
    if (parsed.word) {
      commitLook(botAvatarWordValue(color, parsed.word) ?? color);
      return;
    }
    commitLook(parsed.shapeIndex === undefined ? color : `${color}::shape_${parsed.shapeIndex}`);
  }

  function generateWord() {
    if (!wordPreview) {
      setWordDraft(null);
      setDraftPicture(null);
      return;
    }
    setWordDraft(null);
    setDraftPicture(null);
    if (wordPreview !== value) commitLook(wordPreview);
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={avatarSet}
        onValueChange={(next) =>
          onAvatarSetChange?.(resolveBotAvatarSet(next), avatarValueForIconSet(resolveBotAvatarSet(next), value))
        }
      >
        <TabsList className="w-full" aria-label={t`Icon set`}>
          <TabsTrigger value="organic" className="flex-1">
            <Trans>Original</Trans>
          </TabsTrigger>
          <TabsTrigger value="atlas" className="flex-1">
            <Trans>Atlas</Trans>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {avatarSet === "atlas" ? (
        <p className="text-[12px] text-muted-foreground">
          <Trans>Atlas uses the logo below. Shapes and word icons switch to Original.</Trans>
        </p>
      ) : null}
      <div>
          {organicIdentities ? null : (
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                <Trans>Shape</Trans>
              </div>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                data-testid="avatar-studio-default"
                aria-pressed={isDefaultLook}
                onClick={() => {
                  setWordDraft(null);
                  setDraftPicture(null);
                  const next = defaultBotAvatarValue(value);
                  if (next !== value) commitLook(next);
                }}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  isDefaultLook
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Trans>Default</Trans>
              </Button>
            </div>
          )}
          <div
            className={`grid place-items-center gap-2 ${organicIdentities ? "grid-cols-4 sm:grid-cols-8 sm:gap-1" : "grid-cols-4"}`}
          >
            {organicIdentities?.map((organicIdentity, index) => (
              <BotShapePreview
                key={organicIdentity}
                identity={organicIdentity}
                label={t`Shape ${index + 1}`}
                color={currentColor}
                selected={isDefaultLook && identity === organicIdentity}
                onClick={() => {
                  setWordDraft(null);
                  setDraftPicture(null);
                  commitLook(currentColor, organicIdentity);
                }}
              />
            ))}
            {SHIPPED_BOT_AVATAR_SHAPE_KEYS.map((key, shapeIndex) => (
              <BotShapePreview
                key={key}
                shapeIndex={shapeIndex}
                color={currentColor}
                selected={!parsed.isImage && parsed.shapeIndex === shapeIndex}
                onClick={() => {
                  setWordDraft(null);
                  setDraftPicture(null);
                  commitLook(`${currentColor}::shape_${shapeIndex}`);
                }}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Input
              aria-label={t`Shape from a word`}
              placeholder={t`Word`}
              value={wordShown}
              maxLength={AVATAR_WORD_MAX_LENGTH}
              data-testid="avatar-word"
              data-selected={wordIsPicture ? "true" : "false"}
              className={`w-auto min-w-0 flex-1 ${wordIsPicture ? "ring-2 ring-primary" : ""}`}
              onChange={(event) => editWord(event.target.value)}
              onBlur={() => {
                if (wordPreview && wordPreview !== value) {
                  generateWord();
                  return;
                }
                if (!wordPreview) {
                  setWordDraft(null);
                  setDraftPicture(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                generateWord();
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={!wordPreview || wordPreview === value}
              onClick={generateWord}
            >
              <Trans>Apply</Trans>
            </Button>
          </div>
        </div>

      <div className="border-t border-border pt-2">
        {organicIdentities ? null : (
          <div className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
            <Trans>Color</Trans>
          </div>
        )}
        <div className="grid grid-cols-6 place-items-center gap-2">
          {BOT_AVATAR_COLORS.map((color) => {
            const selected = currentColor.toLowerCase() === color.toLowerCase() && !parsed.isImage;
            const pale = isPaleAvatarSwatch(color);
            return (
              <button
                key={color}
                type="button"
                onClick={() => selectColor(color)}
                aria-label={t`Color ${color}`}
                aria-pressed={selected}
                className={`size-6 rounded-full border transition-transform hover:scale-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring ${
                  selected
                    ? "scale-105 border-transparent ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                    : pale
                      ? "border-foreground/45 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]"
                      : "border-border"
                }`}
                style={{ backgroundColor: color }}
              />
            );
          })}
        </div>
      </div>

      {SHIPPED_BOT_AVATAR_IMAGES.length > 0 ? (
        <div className="border-t border-border pt-2">
          {organicIdentities ? null : (
            <div className="mb-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              <Trans>Custom</Trans>
            </div>
          )}
          <div className="grid grid-cols-4 place-items-center gap-2">
            {SHIPPED_BOT_AVATAR_IMAGES.map((image) => {
              const selected = parsed.isImage && value === image.value;
              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => {
                    setWordDraft(null);
                    setDraftPicture(null);
                    commitLook(image.value);
                  }}
                  aria-label={t`Custom ${image.id}`}
                  aria-pressed={selected}
                  data-testid={`avatar-studio-custom-${image.id}`}
                  className={`relative flex size-11 items-center justify-center overflow-hidden rounded-xl transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover ${
                    selected
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-popover"
                      : "hover:bg-white/5"
                  }`}
                >
                  <img src={image.value} alt="" className="size-8 object-contain" />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export interface AvatarStudioPopoverProps {
  value: string;
  identity?: string;
  status?: string;
  avatarSet?: BotAvatarSet;
  size?: number;
  onChange: (value: string, avatarSet?: BotAvatarSet) => void;
  disabled?: boolean;
}

export function AvatarStudioPopover({
  value,
  identity,
  status,
  avatarSet = "organic",
  size = 72,
  onChange,
  disabled = false,
}: AvatarStudioPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pendingLook, setPendingLook] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"bot" | "upload">("bot");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function restoreDefaultAvatar() {
    const next = defaultBotAvatarValue(value);
    if (next !== value) onChange(next);
  }

  function processImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const targetSize = 256;
        canvas.width = targetSize;
        canvas.height = targetSize;
        if (!ctx) return;

        ctx.beginPath();
        ctx.arc(targetSize / 2, targetSize / 2, targetSize / 2, 0, Math.PI * 2);
        ctx.clip();

        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetSize, targetSize);

        onChange(canvas.toDataURL("image/webp", 0.9));
        setOpen(false);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) processImageFile(file);
  }

  function handlePaste(event: ClipboardEvent<HTMLButtonElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item?.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) {
        processImageFile(file);
        break;
      }
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="group relative cursor-pointer rounded-2xl outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t`Customize bot avatar`}
        data-testid="avatar-studio-trigger"
      >
        <BotAvatar
          color={value}
          identity={identity}
          size={size}
          status={status}
          avatarSet={avatarSet}
        />
        <div className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border-2 border-background bg-secondary text-foreground shadow-md transition-transform group-hover:scale-110">
          <Pencil size={12} strokeWidth={2.2} />
        </div>
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && pendingLook && pendingLook !== value) {
            onChange(pendingLook);
          }
          setOpen(next);
          if (!next) setPendingLook(null);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] w-[360px] max-w-full gap-4 overflow-y-auto rounded-3xl p-5 sm:max-w-[360px]"
          data-testid="avatar-studio"
        >
          <DialogHeader className="flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-[14px] font-semibold tracking-tight">
              <Trans>Avatar Studio</Trans>
            </DialogTitle>
            <DialogDescription className="sr-only">
              <Trans>Choose a bot shape, color, or upload an image</Trans>
            </DialogDescription>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full text-muted-foreground"
              aria-label={t`Close`}
            >
              <X size={16} />
            </Button>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center py-2">
            <BotAvatar
              color={pendingLook ?? value}
              identity={identity}
              size={78}
              status={status}
              avatarSet={studioPreviewAvatarSet(value, pendingLook, avatarSet)}
            />
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(next) => setActiveTab(next as "bot" | "upload")}
            className="gap-4"
          >
            <div className="flex items-center justify-between border-b border-border pb-1">
              <TabsList className="rounded-full">
                <TabsTrigger value="bot" className="rounded-full px-3 text-xs">
                  <Trans>Bot</Trans>
                </TabsTrigger>
                <TabsTrigger value="upload" className="rounded-full px-3 text-xs">
                  <Trans>Upload</Trans>
                </TabsTrigger>
              </TabsList>

              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={restoreDefaultAvatar}
                className="text-xs text-muted-foreground"
              >
                <Trans>Reset</Trans>
              </Button>
            </div>

            <TabsContent value="bot" className="pt-1" data-testid="avatar-studio-bot-tab">
              <BotLookPicker
                value={value}
                identity={identity}
                avatarSet={avatarSet}
                onPreviewChange={setPendingLook}
                onChange={(next) => onChange(next)}
                onAvatarSetChange={(set, next) => onChange(next, set)}
              />
            </TabsContent>
            <TabsContent value="upload">
              <button
                type="button"
                aria-label={t`Image upload area`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onPaste={handlePaste}
                onClick={() => fileInputRef.current?.click()}
                className={`flex w-full flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/10"
                    : "border-border bg-muted hover:border-foreground/30"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) processImageFile(file);
                  }}
                />
                <div className="mb-2 grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground">
                  <Upload size={18} strokeWidth={1.8} />
                </div>
                <p className="text-[12.5px] font-medium text-muted-foreground">
                  <Trans>Drag, drop, or paste an image</Trans>
                </p>
                <span className="mt-3 rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-foreground">
                  <Trans>Choose file</Trans>
                </span>
              </button>
            </TabsContent>
          </Tabs>

          <DialogFooter className="border-border sm:justify-end">
            <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(false)}>
              <Check size={14} />
              <Trans>Done</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
