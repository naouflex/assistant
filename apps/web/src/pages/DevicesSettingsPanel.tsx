import { ANDROID_APK_URL } from "@atlas/contracts";
import type { LocalServerStatus } from "@atlas/contracts";
import { Button } from "@atlas/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { ComputerDeviceSettings } from "../components/ComputerDeviceSettings";
import { LocalModelHostSettings } from "../components/LocalModelHostSettings";
import { SettingsGroup, SettingsRow } from "../components/SettingsRows";
import { useSpaceQueries } from "../lib/query";

const QR_QUIET_ZONE = 2;

/** Dark modules as one SVG path, with a quiet zone so a phone camera can read it. */
function qrPath(data: Uint8Array, size: number): string {
  let path = "";
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!data[row * size + col]) {
        col += 1;
        continue;
      }
      const start = col;
      while (col < size && data[row * size + col]) col += 1;
      const width = col - start;
      path += `M${start + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h${width}v1h-${width}z`;
    }
  }
  return path;
}

function ApkQr() {
  const [symbol, setSymbol] = useState<{ size: number; path: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then((qrcode) => {
      if (cancelled) return;
      const symbol = qrcode.create(ANDROID_APK_URL, { errorCorrectionLevel: "M" });
      setSymbol({
        size: symbol.modules.size + QR_QUIET_ZONE * 2,
        path: qrPath(symbol.modules.data, symbol.modules.size),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <svg
      viewBox={symbol ? `0 0 ${symbol.size} ${symbol.size}` : "0 0 1 1"}
      className="size-40 bg-white text-black"
      shapeRendering="crispEdges"
      aria-hidden="true"
      data-testid="devices-apk-qr-mark"
    >
      {symbol ? <path d={symbol.path} fill="currentColor" /> : null}
    </svg>
  );
}

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
                <SettingsRow
                  key={server.baseUrl}
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
            href={ANDROID_APK_URL}
            data-testid="devices-apk-qr"
            className="flex flex-col items-center gap-3"
          >
            <span className="rounded-lg bg-white p-3">
              <ApkQr />
            </span>
            <span className="text-[14px] text-foreground">
              <Trans>Install the Atlas APK and sign in</Trans>
            </span>
          </a>
        </div>
      </SettingsGroup>
    </div>
  );
}
