import type { UserDeviceSummary } from "@atlas/contracts";
import { NativeSelect, NativeSelectOption } from "@atlas/ui-web";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { listUserDevices } from "../../lib/user-devices";

/** Shown only when the owner has more than one computer a bot could use. */
export function BotDevicePicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string | null;
  onChange: (deviceId: string | null) => Promise<void>;
}) {
  const { t } = useLingui();
  const [devices, setDevices] = useState<UserDeviceSummary[]>([]);
  const [selected, setSelected] = useState(value ?? "");
  const [failed, setFailed] = useState(false);
  useEffect(() => setSelected(value ?? ""), [value]);
  useEffect(() => {
    listUserDevices()
      .then((listed) => setDevices(listed.filter((device) => device.platform !== "android")))
      .catch(() => undefined);
  }, []);

  if (devices.length < 2 && !value) return null;
  return (
    <label
      htmlFor={id}
      className="mt-3 flex min-h-11 items-center justify-between gap-3 text-sm text-foreground"
    >
      <Trans>Your computer</Trans>
      <NativeSelect
        id={id}
        data-testid="bot-device-picker"
        className="max-w-2/3"
        value={selected}
        aria-invalid={failed || undefined}
        onChange={(event) => {
          const previous = selected;
          const next = event.target.value;
          setSelected(next);
          setFailed(false);
          onChange(next || null).catch(() => {
            setSelected(previous);
            setFailed(true);
          });
        }}
      >
        <NativeSelectOption value="">{t`Newest connected`}</NativeSelectOption>
        {devices.map((device) => (
          <NativeSelectOption key={device.deviceId} value={device.deviceId}>
            {device.connected ? device.name : t`${device.name} (offline)`}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
