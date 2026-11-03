import type { UserDevicePairResponse } from "@atlas/contracts";
import { USER_DEVICE_PAIR_PATH } from "@atlas/contracts";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import { authHeaders, currentApiBase } from "./api";
import { apiBaseWarning } from "./endpoint";
import { t } from "./i18n";
import { fetchServer, serverHeaders } from "./server-headers";

export interface PhoneControlState {
  enabled: boolean;
  connected: boolean;
  paired: boolean;
  endpoint: string;
  deviceId: string;
  accessibility: boolean;
  screenshots: boolean;
  idleMinutes: number;
  termuxInstalled: boolean;
  termuxAllowed: boolean;
  notifications: boolean;
  deeperCommandsInstalled: boolean;
  deeperCommandsRunning: boolean;
  deeperCommandsAllowed: boolean;
  deviceName: string;
}

type NativePhoneControl = {
  getState(): Promise<PhoneControlState>;
  pair(endpoint: string, deviceId: string, token: string, headers: string): Promise<void>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  setIdleMinutes(minutes: number): Promise<void>;
  forget(): Promise<boolean>;
  openAccessibilitySettings(): Promise<void>;
  requestTermuxPermission(): Promise<void>;
  openNotificationSettings(): Promise<void>;
  requestDeeperCommands(): Promise<void>;
};

// Optional: an update can reach an older app build without this module.
const nativePhone =
  Platform.OS === "android"
    ? requireOptionalNativeModule<NativePhoneControl>("AtlasPhoneControl")
    : null;

export const PHONE_IDLE_MINUTES = [5, 15, 30, 60] as const;

export function hasPhoneControl(): boolean {
  return nativePhone !== null;
}

function phone(): NativePhoneControl {
  if (!nativePhone) throw new Error(t("Phone control needs the Android app."));
  return nativePhone;
}

export function getPhoneControlState(): Promise<PhoneControlState> {
  return phone().getState();
}

export function parsePairResponse(body: unknown): UserDevicePairResponse {
  const value = body as Partial<UserDevicePairResponse> | null;
  if (
    typeof value?.deviceId !== "string" ||
    !value.deviceId ||
    typeof value.token !== "string" ||
    !value.token
  )
    throw new Error(t("The server did not pair this phone."));
  return { deviceId: value.deviceId, token: value.token };
}

/** A pairing belongs to one server; a phone paired with another one pairs again. */
export function needsPairing(state: PhoneControlState, apiBase: string): boolean {
  return !state.paired || state.endpoint.replace(/\/+$/, "") !== apiBase.replace(/\/+$/, "");
}

/** Pairs this phone with the signed-in account on first use, then starts the connection. */
export async function turnOnPhoneControl(): Promise<PhoneControlState> {
  const native = phone();
  const apiBase = currentApiBase();
  const warning = apiBaseWarning(apiBase);
  if (warning) throw new Error(warning);
  const state = await native.getState();
  if (needsPairing(state, apiBase)) {
    if (state.paired) await native.forget();
    const response = await fetchServer(
      `${apiBase}${USER_DEVICE_PAIR_PATH}`,
      {
        method: "POST",
        headers: { ...(await authHeaders(null)), "content-type": "application/json" },
        body: JSON.stringify({
          name: state.deviceName.slice(0, 128) || "Android",
          platform: "android",
        }),
      },
      apiBase,
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${response.status}`);
    }
    const pairing = parsePairResponse(await response.json());
    await native.pair(
      apiBase,
      pairing.deviceId,
      pairing.token,
      JSON.stringify(serverHeaders(apiBase)),
    );
  }
  await native.enable();
  return native.getState();
}

export async function turnOffPhoneControl(): Promise<PhoneControlState> {
  await phone().disable();
  return phone().getState();
}

export async function setPhoneIdleMinutes(minutes: number): Promise<PhoneControlState> {
  await phone().setIdleMinutes(minutes);
  return phone().getState();
}

/** Revokes this phone on the server and forgets its token. */
export async function removePhone(): Promise<PhoneControlState> {
  await phone().forget();
  return phone().getState();
}

export function openAccessibilitySettings(): Promise<void> {
  return phone().openAccessibilitySettings();
}

export function allowTermux(): Promise<void> {
  return phone().requestTermuxPermission();
}

export function openNotificationAccess(): Promise<void> {
  return phone().openNotificationSettings();
}

export function allowDeeperCommands(): Promise<void> {
  return phone().requestDeeperCommands();
}
