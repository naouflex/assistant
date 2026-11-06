import type { AtlasDesktopDevice, UserDeviceSummary } from "@atlas/contracts";
import { Button, Input, Label, Switch } from "@atlas/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { desktopBridge } from "../lib/desktop";
import { listUserDevices, pairUserDevice, removeUserDevice } from "../lib/user-devices";
import { SettingsGroup, SettingsRow } from "./SettingsRows";

export function ComputerDeviceSettings({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const { t } = useLingui();
  const desktop = desktopBridge()?.device;
  const [devices, setDevices] = useState<UserDeviceSummary[]>([]);
  const [thisComputer, setThisComputer] = useState<AtlasDesktopDevice | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const switchId = useId();
  const nameId = useId();
  const [newName, setNewName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [listed, local] = await Promise.all([
      listUserDevices().catch(() => null),
      desktop?.state().catch(() => null) ?? null,
    ]);
    if (listed) setDevices(listed);
    setThisComputer(local);
  }, [desktop]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, failure: string) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch {
      setError(failure);
    } finally {
      await load();
      setPending(false);
    }
  }

  const empty = devices.length === 0 && !thisComputer;
  if (empty && !alwaysShow) return null;

  return (
    <SettingsGroup title={<Trans>Computers</Trans>} data-testid="computer-devices">
      {thisComputer ? (
        <SettingsRow
          label={
            <Label htmlFor={switchId} className="text-[14px] font-normal text-foreground">
              <Trans>Let bots use this computer</Trans>
            </Label>
          }
          control={
            <Switch
              id={switchId}
              data-testid="this-computer-toggle"
              checked={thisComputer.allowed}
              disabled={pending}
              onCheckedChange={(allowed) =>
                void run(() => desktop!.setAllowed(allowed), t`Could not change`)
              }
            />
          }
        />
      ) : null}
      {devices.map((device) => (
        <SettingsRow
          key={device.deviceId}
          label={
            <p className="flex min-w-0 items-baseline gap-2">
              <span className="truncate">{device.name}</span>
              <span className="shrink-0 text-[12.5px] text-muted-foreground">
                {device.connected ? <Trans>Connected</Trans> : <Trans>Offline</Trans>}
              </span>
            </p>
          }
          control={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t`Remove ${device.name}`}
              disabled={pending}
              className="text-destructive hover:text-destructive"
              onClick={() => void run(() => removeUserDevice(device.deviceId), t`Could not remove`)}
            >
              <Trash2 />
            </Button>
          }
        />
      ))}
      {empty ? (
        <SettingsRow
          label={
            <Trans>
              Install Atlas Desktop on Windows, sign in to this server, then allow bots to use it
            </Trans>
          }
        />
      ) : null}
      {newToken ? (
        <SettingsRow
          label={<Trans>Token for {newName}, shown once</Trans>}
          control={
            <Input
              readOnly
              aria-label={t`Token`}
              data-testid="new-computer-token"
              value={newToken}
              onFocus={(event) => event.currentTarget.select()}
              className="w-56 font-mono"
            />
          }
        />
      ) : (
        <form
          className="flex items-center gap-2 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newName.trim();
            if (!name) return;
            setPending(true);
            setError(null);
            pairUserDevice(name)
              .then((paired) => setNewToken(paired.token))
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : t`Could not add`),
              )
              .finally(() => {
                setPending(false);
                void load();
              });
          }}
        >
          <Input
            id={nameId}
            aria-label={t`New computer name`}
            placeholder={t`Add a Linux computer`}
            value={newName}
            maxLength={128}
            onChange={(event) => setNewName(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending || !newName.trim()}>
            <Trans>Add</Trans>
          </Button>
        </form>
      )}
      {error ? (
        <p role="alert" className="px-4 py-3 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </SettingsGroup>
  );
}
