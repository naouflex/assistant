import type { ChatModelChoice } from "@atlas/core";
import { groupModelChoices, MODEL_SEARCH_THRESHOLD } from "@atlas/core";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  NativeSelect,
  NativeSelectOption,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@atlas/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useMemo, useState } from "react";
import { TextOnlyMark } from "../../components/TextOnlyMark";

/** A chat's model: a native select, or a searchable list once there are too many to scan. */
export function ChatModelPicker({
  id,
  choices,
  value,
  onChange,
  compact = false,
  ariaLabel,
  localNotes,
  onRefreshLocal,
  refreshingLocal = false,
  afterControl,
}: {
  id: string;
  /** Small inline control, as under the composer, labelled by ariaLabel. */
  compact?: boolean;
  ariaLabel?: string;
  choices: readonly ChatModelChoice[];
  value: string;
  onChange: (key: string) => void;
  /** Status note per local choice key, such as "16K ctx" or "offline". */
  localNotes?: ReadonlyMap<string, string>;
  /** Shows a button that rescans the local model servers. */
  onRefreshLocal?: () => void;
  refreshingLocal?: boolean;
  /** Sits immediately after the selector, before the image mark and refresh button. */
  afterControl?: ReactNode;
}) {
  const { t } = useLingui();
  const imagesHintId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sections = useMemo(() => groupModelChoices(choices, query), [choices, query]);
  const selected = choices.find((choice) => choice.key === value) ?? choices[0];
  const textOnly = selected?.images === false;
  const imagesHint = <span id={imagesHintId} hidden>{t`Can't read images`}</span>;
  const imageMark = textOnly ? (
    <span className="shrink-0 text-muted-foreground">
      <TextOnlyMark />
    </span>
  ) : null;
  const note = (key: string) => localNotes?.get(key);
  const refreshButton = onRefreshLocal ? (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "icon-xs" : "icon-sm"}
      className="shrink-0 text-muted-foreground"
      aria-label={t`Refresh local models`}
      title={t`Refresh local models`}
      data-testid="refresh-local-models"
      disabled={refreshingLocal}
      onClick={onRefreshLocal}
    >
      <RefreshCwIcon className={refreshingLocal ? "animate-spin" : undefined} aria-hidden="true" />
    </Button>
  ) : null;

  if (choices.length <= MODEL_SEARCH_THRESHOLD) {
    return (
      <div
        className={
          compact ? "flex min-w-0 flex-1 items-center gap-2" : "mt-2 flex items-center gap-2"
        }
      >
        {imagesHint}
        <NativeSelect
          id={id}
          aria-label={ariaLabel}
          size={compact ? "sm" : undefined}
          className={compact ? "min-w-0 w-full max-w-lg flex-1" : "w-full"}
          aria-describedby={textOnly ? imagesHintId : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {choices.map((choice) => (
            <NativeSelectOption key={choice.key} value={choice.key}>
              {note(choice.key) ? `${choice.label} \u00b7 ${note(choice.key)}` : choice.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {afterControl}
        {imageMark}
        {refreshButton}
      </div>
    );
  }

  function openChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  const popover = (
    <Popover open={open} onOpenChange={openChange}>
      {imagesHint}
      <PopoverTrigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={textOnly ? imagesHintId : undefined}
        title={selected?.label}
        className={`${compact ? "h-7 min-w-0 w-full max-w-lg flex-1 text-sm" : "mt-2 h-8 w-full text-sm"} flex items-center justify-between gap-2 rounded-lg border border-input bg-transparent pr-2.5 pl-2.5 text-start text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50`}
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {textOnly && !afterControl ? <TextOnlyMark /> : null}
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        </span>
      </PopoverTrigger>
      {open ? (
        <PopoverContent
          align="start"
          side="bottom"
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          className="w-[min(40rem,var(--available-width))] max-h-(--available-height) max-w-(--available-width) gap-0 overflow-hidden bg-popover p-0 opacity-100 animate-none! backdrop-filter-none"
        >
          <Command
            shouldFilter={false}
            className="h-auto min-h-0 max-h-(--available-height) rounded-none bg-popover *:data-[slot=command-input-wrapper]:shrink-0"
          >
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t`Search`}
              aria-label={t`Search models`}
            />
            <CommandList className="min-h-0 max-h-80 flex-1 overflow-y-auto">
              <CommandEmpty>
                <Trans>No matching models</Trans>
              </CommandEmpty>
              {sections.map((section) => (
                <CommandGroup key={section.key} heading={section.heading}>
                  {section.data.map((choice) => (
                    <CommandItem
                      key={choice.key}
                      aria-label={choice.label}
                      // cmdk falls back to the row's text for an empty value.
                      value={choice.key || "space-default"}
                      data-checked={choice.key === value}
                      aria-describedby={choice.images === false ? imagesHintId : undefined}
                      onSelect={() => {
                        onChange(choice.key);
                        openChange(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 whitespace-normal break-words">
                        {choice.title ?? choice.label}
                      </span>
                      {note(choice.key) ? (
                        <span className="shrink-0 text-muted-foreground text-xs">
                          {note(choice.key)}
                        </span>
                      ) : null}
                      {choice.images === false ? (
                        <span className="shrink-0 text-muted-foreground">
                          <TextOnlyMark />
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      ) : null}
    </Popover>
  );
  if (!refreshButton && !afterControl) return popover;
  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${compact ? "flex-1" : ""} ${afterControl ? "" : "[&>button:first-of-type]:min-w-0 [&>button:first-of-type]:flex-1"}`}
    >
      {popover}
      {afterControl}
      {afterControl ? imageMark : null}
      {refreshButton}
    </div>
  );
}
