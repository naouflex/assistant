import type { LocalModelsStatus } from "@atlas/contracts";
import type { ChatModelChoice } from "@atlas/core";
import { useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSpaceQueries } from "../../lib/query";

const LOCAL_PROVIDER = "local";

export type LocalModelFacts = {
  reachable: boolean;
  /** Context the server runs the model with, when it says. */
  contextWindow: number | null;
  /** Context Atlas sends (ATLAS_LOCAL_CONTEXT_WINDOW). */
  atlasContextWindow: number | null;
  /** Too big for an 8 GB GPU. */
  large: boolean;
};

/** What the servers say about one local model, or null when no server lists it. */
export function localModelFacts(
  status: LocalModelsStatus | undefined,
  modelId: string,
): LocalModelFacts | null {
  if (!status) return null;
  for (const server of status.servers) {
    const model = server.models.find(
      (entry) => entry.id === modelId || entry.aliases.includes(modelId),
    );
    if (model)
      return {
        reachable: server.reachable,
        contextWindow: model.contextWindow,
        atlasContextWindow: status.contextWindow,
        large: model.large,
      };
  }
  return {
    reachable: false,
    contextWindow: null,
    atlasContextWindow: status.contextWindow,
    large: false,
  };
}

export function contextLabel(tokens: number): string {
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}K` : String(tokens);
}

/**
 * Local servers' status for the picker: a note per local choice (offline, context size, slow on
 * an 8 GB GPU) and a refresh that rescans the servers and reloads the model list.
 */
export function useLocalModelStatus(choices: readonly ChatModelChoice[]) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const hasLocal = choices.some((choice) => choice.provider === LOCAL_PROVIDER);
  const status = useQuery({
    ...queries.models.localStatus.queryOptions({ input: {} }),
    enabled: hasLocal,
    staleTime: 30_000,
  }).data;

  const notes = useMemo(() => {
    const out = new Map<string, string>();
    if (!status) return out;
    for (const choice of choices) {
      if (choice.provider !== LOCAL_PROVIDER || !choice.modelId) continue;
      const facts = localModelFacts(status, choice.modelId);
      if (!facts) continue;
      if (!facts.reachable) {
        out.set(choice.key, t`offline`);
        continue;
      }
      const parts: string[] = [];
      if (facts.contextWindow) {
        const ctx = contextLabel(facts.contextWindow);
        parts.push(
          facts.atlasContextWindow && facts.contextWindow < facts.atlasContextWindow
            ? t`${ctx} ctx, Atlas sends ${contextLabel(facts.atlasContextWindow)}`
            : t`${ctx} ctx`,
        );
      }
      if (facts.large) parts.push(t`slow on 8 GB GPU`);
      out.set(choice.key, parts.length ? parts.join(" \u00b7 ") : t`online`);
    }
    return out;
  }, [choices, status, t]);

  async function refresh() {
    setRefreshing(true);
    try {
      const next = await queries.models.localStatus.call({ refresh: true });
      queryClient.setQueryData(queries.models.localStatus.queryKey({ input: {} }), next);
      await queryClient.invalidateQueries({ queryKey: queries.models.list.key() });
    } finally {
      setRefreshing(false);
    }
  }

  return { hasLocal, notes, refresh, refreshing };
}
