import type { Bot, ModelCatalogEntry, ThinkingLevel } from "@atlas/contracts";
import {
  chatModelChoices,
  connectedModelChoices,
  credentialForModel,
  modelOptionKey,
  parseModelOptionKey,
  resolveSelectableModelId,
} from "@atlas/core";
import { Toggle } from "@atlas/ui-web";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Brain } from "lucide-react";
import { useId, useState } from "react";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { ChatModelPicker } from "./chat-model-picker";
import { thinkingIsOn, thinkingToggleLevels } from "./composer-thinking";
import { useLocalModelStatus } from "./local-model-status";

export type ComposerModelPatch = {
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: ThinkingLevel | null;
};

/**
 * The chat's model and thinking switch under the composer. Both save to the bot, so the
 * next run uses them; the bot settings panel shows the same values.
 */
export function ComposerModelControls({
  bot,
  onSave,
}: {
  bot: Bot;
  onSave: (patch: ComposerModelPatch) => Promise<void>;
}) {
  const { t } = useLingui();
  const id = useId();
  const queries = useSpaceQueries();
  const credentials = useQuery(queries.models.credentials.queryOptions()).data;
  const catalog = useQuery(queries.models.list.queryOptions()).data;
  const me = useQuery(queries.me.queryOptions()).data;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const localStatus = useLocalModelStatus(
    credentials && catalog ? connectedModelChoices(credentials, catalog) : [],
  );
  if (!credentials || !catalog || !me) return null;

  const stored =
    bot.modelProvider && bot.modelId
      ? { provider: bot.modelProvider, modelId: bot.modelId }
      : parseModelOptionKey("");
  const selected = stored
    ? {
        provider: stored.provider,
        modelId: resolveSelectableModelId(catalog, stored.provider, stored.modelId),
      }
    : null;
  const selectedKey = selected ? modelOptionKey(selected.provider, selected.modelId) : "";
  const provider = selected?.provider ?? me.defaultProvider ?? null;
  const modelId = selected?.modelId ?? me.defaultModel ?? null;
  const entry = findEntry(catalog, provider, modelId);
  const defaultEntry = findEntry(catalog, me.defaultProvider, me.defaultModel);
  const choices = chatModelChoices(
    connectedModelChoices(credentials, catalog),
    selectedKey,
    t`Space default`,
    defaultEntry?.images,
  );
  const credential = credentialForModel(credentials, provider, modelId);
  const toggle = thinkingToggleLevels(credential?.thinkingLevels ?? entry?.thinkingLevels);
  const thinking = thinkingIsOn(
    bot.thinkingLevel,
    credential?.thinkingLevel ?? entry?.defaultThinkingLevel ?? undefined,
  );

  async function save(patch: ComposerModelPatch) {
    setSaving(true);
    setError(null);
    try {
      await onSave(patch);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs" data-testid="composer-model-controls">
      <div className="min-w-0 max-w-[18rem]">
        <ChatModelPicker
          id={id}
          compact
          ariaLabel={t`Model for ${bot.name}`}
          choices={choices}
          localNotes={localStatus.notes}
          onRefreshLocal={localStatus.hasLocal ? () => void localStatus.refresh() : undefined}
          refreshingLocal={localStatus.refreshing}
          value={selectedKey}
          onChange={(key) => {
            const next = key ? parseModelOptionKey(key) : null;
            void save({
              modelProvider: next?.provider ?? null,
              modelId: next?.modelId ?? null,
              // A saved level may not exist on the next model; let it use its default.
              thinkingLevel: null,
            });
          }}
        />
      </div>
      {toggle ? (
        <Toggle
          size="sm"
          variant="outline"
          aria-label={t`Thinking`}
          title={thinking ? t`Thinking on: slower, more careful` : t`Thinking off: fastest replies`}
          pressed={thinking}
          disabled={saving}
          onPressedChange={(on) =>
            void save({
              modelProvider: bot.modelProvider ?? null,
              modelId: bot.modelId ?? null,
              thinkingLevel: on ? toggle.on : toggle.off,
            })
          }
          className="h-7 gap-1 rounded-full px-2.5 text-xs"
        >
          <Brain size={13} strokeWidth={1.8} />
          {thinking ? t`Thinking` : t`No thinking`}
        </Toggle>
      ) : null}
      {error ? <span className="truncate text-destructive">{error}</span> : null}
    </div>
  );
}

function findEntry(
  catalog: readonly ModelCatalogEntry[],
  provider: string | null | undefined,
  modelId: string | null | undefined,
) {
  if (!provider || !modelId) return undefined;
  return catalog.find(
    (entry) =>
      entry.provider === provider &&
      resolveSelectableModelId([...catalog], entry.provider, entry.id) === modelId,
  );
}
