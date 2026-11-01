import type { DesktopLocalModelHostState } from "@atlas/contracts";
import { Button } from "@atlas/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

/** Start/stop the Windows-native CUDA llama-server from Devices. */
export function LocalModelHostSettings() {
  const { t } = useLingui();
  const bridge = desktopBridge()?.localModel;
  const [state, setState] = useState<DesktopLocalModelHostState | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge.state().then((next) => {
      if (!cancelled) setState(next);
    });
    return bridge.onChange((next) => {
      if (!cancelled) setState(next);
    });
  }, [bridge]);

  if (!bridge || !state?.supported) return null;

  const busy =
    pending ||
    state.phase === "downloading-runtime" ||
    state.phase === "installing-runtime" ||
    state.phase === "downloading-model" ||
    state.phase === "installing-model" ||
    state.phase === "starting";
  const online = state.online || state.phase === "running";
  const status =
    online || state.phase === "running"
      ? t`Online`
      : state.phase === "downloading-runtime" || state.phase === "installing-runtime"
        ? t`Installing runtime`
        : state.phase === "downloading-model" || state.phase === "installing-model"
          ? t`Installing model`
          : state.phase === "starting"
            ? t`Starting`
            : state.phase === "failed"
              ? t`Failed`
              : state.phase === "unsupported"
                ? t`Windows only`
                : t`Offline`;

  return (
    <SettingsGroup title={<Trans>Local model</Trans>} data-testid="local-model-host">
      <SettingsRow
        label={
          <p className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate">{state.modelLabel}</span>
            <span className="text-[12.5px] text-muted-foreground">
              {status}
              {state.progress != null ? ` · ${state.progress}%` : null}
              {state.message ? ` · ${state.message}` : null}
            </span>
          </p>
        }
        control={
          <Button
            type="button"
            variant={online ? "outline" : "default"}
            size="sm"
            disabled={busy}
            data-testid="local-model-host-toggle"
            onClick={() => {
              setPending(true);
              void (online ? bridge.stop() : bridge.start())
                .then((next) => setState(next))
                .finally(() => setPending(false));
            }}
          >
            {online ? <Trans>Stop</Trans> : <Trans>Start</Trans>}
          </Button>
        }
      />
    </SettingsGroup>
  );
}
