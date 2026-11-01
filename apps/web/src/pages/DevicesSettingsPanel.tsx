import { IOS_APP_STORE_URL } from "@atlas/contracts";
import type { LocalServerStatus } from "@atlas/contracts";
import { Button } from "@atlas/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { ComputerDeviceSettings } from "../components/ComputerDeviceSettings";
import { LocalModelHostSettings } from "../components/LocalModelHostSettings";
import { QrMark } from "../components/QrCode";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { useSpaceQueries } from "../lib/query";

function serverHost(server: LocalServerStatus): string {
  try {
    return new URL(server.baseUrl).host;
  } catch {
    return server.baseUrl;
  }
}

/** Server, model hosts, computers, and phone — one place for a personal install. */
export function DevicesSettingsPanel() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingModel, setLoadingModel] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    let cancelled = false;
    void fetch("/health", { signal: AbortSignal.timeout(4_000) })
      .then((response) => {
        if (!cancelled) setServerOnline(response.ok);
      })
      .catch(() => {
        if (!cancelled) setServerOnline(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const status = useQuery({
    ...queries.models.localStatus.queryOptions({ input: {} }),
    staleTime: 30_000,
  }).data;

  async function refreshModels() {
    setRefreshing(true);
    try {
      const next = await queries.models.localStatus.call({ refresh: true });
      queryClient.setQueryData(queries.models.localStatus.queryKey({ input: {} }), next);
      await queryClient.invalidateQueries({ queryKey: queries.models.list.key() });
    } finally {
      setRefreshing(false);
    }
  }

  async function loadModel(baseUrl: string, modelId: string) {
    setLoadingModel(modelId);
    try {
      const next = await queries.models.loadLocal.call({ baseUrl, modelId });
      queryClient.setQueryData(queries.models.localStatus.queryKey({ input: {} }), next);
      await queryClient.invalidateQueries({ queryKey: queries.models.list.key() });
    } finally {
      setLoadingModel(null);
    }
  }

  let host = t`This server`;
  try {
    if (origin) host = new URL(origin).host;
  } catch {
    if (origin) host = origin;
  }

  const servers = status?.servers ?? [];

  return (
    <div className="flex flex-col gap-6" data-testid="devices-settings">
      <SettingsGroup title={<Trans>Server</Trans>} data-testid="devices-server">
        <SettingsRow
          label={<span className="truncate">{host}</span>}
          control={
            <span className="text-[12.5px] text-muted-foreground">
              {serverOnline == null ? (
                <Trans>Checking</Trans>
              ) : serverOnline ? (
                <Trans>Online</Trans>
              ) : (
                <Trans>Offline</Trans>
              )}
            </span>
          }
        />
      </SettingsGroup>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <h3 className="text-[14px] font-medium text-foreground">
            <Trans>Models</Trans>
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t`Refresh`}
            disabled={refreshing}
            data-testid="devices-models-refresh"
            onClick={() => void refreshModels()}
          >
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          </Button>
        </div>
        <div
          className="divide-y divide-border rounded-xl border border-border"
          data-testid="devices-models"
        >
          {servers.length === 0 ? (
            <SettingsRow
              label={<Trans>No local model server</Trans>}
              control={
                <span className="text-[12.5px] text-muted-foreground">
                  <Trans>Add one in Models</Trans>
                </span>
              }
            />
          ) : (
            servers.map((server) => {
              const kind =
                server.kind === "llama-server"
                  ? t`llama.cpp`
                  : server.kind === "ollama"
                    ? t`Ollama`
                    : server.kind === "openai-compatible"
                      ? t`OpenAI-compatible`
                      : t`Local`;
              const modelCount =
                server.models.length === 0
                  ? null
                  : server.models.length === 1
                    ? t`1 model`
                    : t`${server.models.length} models`;
              return (
                <div key={server.baseUrl} className="divide-y divide-border">
                  <SettingsRow
                    label={
                      <p className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate">{serverHost(server)}</span>
                        <span className="text-[12.5px] text-muted-foreground">
                          {kind}
                          {modelCount ? ` · ${modelCount}` : null}
                        </span>
                      </p>
                    }
                    control={
                      <span className="text-[12.5px] text-muted-foreground">
                        {server.reachable ? <Trans>Online</Trans> : <Trans>Offline</Trans>}
                      </span>
                    }
                  />
                  {server.models.map((model) => {
                    const loading = loadingModel === model.id;
                    const state = loading ? "loading" : model.loadState;
                    return (
                      <SettingsRow
                        key={model.id}
                        label={
                          <p className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate">{model.id}</span>
                            <span className="text-[12.5px] text-muted-foreground">
                              {state === "loaded" ? (
                                <Trans>Loaded</Trans>
                              ) : state === "loading" ? (
                                <Trans>Loading</Trans>
                              ) : state === "unloaded" ? (
                                <Trans>Not loaded</Trans>
                              ) : null}
                            </span>
                          </p>
                        }
                        control={
                          server.kind === "llama-server" && state === "unloaded" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={loadingModel != null}
                              data-testid={`devices-model-load-${model.id}`}
                              onClick={() => void loadModel(server.baseUrl, model.id)}
                            >
                              <Trans>Load</Trans>
                            </Button>
                          ) : null
                        }
                      />
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      <LocalModelHostSettings />

      <ComputerDeviceSettings alwaysShow />

      <SettingsGroup title={<Trans>Phone</Trans>} data-testid="devices-phone">
        <div className="flex justify-center px-4 py-4">
          <a
            href={IOS_APP_STORE_URL}
            data-testid="devices-apk-qr"
            className="flex flex-col items-center gap-3"
          >
            <span className="rounded-lg bg-white p-3">
              <QrMark value={IOS_APP_STORE_URL} testId="devices-apk-qr-mark" />
            </span>
            <span className="text-[14px] text-foreground">
              <Trans>Install Atlas and sign in</Trans>
            </span>
          </a>
        </div>
      </SettingsGroup>
    </div>
  );
}
