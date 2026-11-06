import type {
  UserDevicePairRequest,
  UserDevicePairResponse,
  UserDeviceSummary,
} from "@atlas/contracts";
import { USER_DEVICE_PAIR_PATH, USER_DEVICE_PATH, userDeviceListSchema } from "@atlas/contracts";
import { readBoundedJsonResponse } from "@atlas/core";
import { t } from "@lingui/core/macro";

export async function listUserDevices(): Promise<UserDeviceSummary[]> {
  const response = await fetch(USER_DEVICE_PATH, { signal: AbortSignal.timeout(8_000) });
  // Servers without user devices have no such route.
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(t`Could not load`);
  try {
    return userDeviceListSchema.parse(await readBoundedJsonResponse<unknown>(response, 64 * 1024))
      .devices;
  } catch {
    throw new Error(t`Could not load`);
  }
}

/** Pairs a computer without a browser, such as a Linux server; the token is shown only once. */
export async function pairUserDevice(name: string): Promise<UserDevicePairResponse> {
  const response = await fetch(USER_DEVICE_PAIR_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, platform: "linux" } satisfies UserDevicePairRequest),
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 409) throw new Error(t`Remove a computer before adding another`);
  if (!response.ok) throw new Error(t`Could not add`);
  return readBoundedJsonResponse<UserDevicePairResponse>(response, 4096);
}

export async function removeUserDevice(deviceId: string): Promise<void> {
  const response = await fetch(`${USER_DEVICE_PATH}/${encodeURIComponent(deviceId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(8_000),
  });
  await response.body?.cancel();
  if (!response.ok && response.status !== 404) throw new Error(t`Could not remove`);
}
