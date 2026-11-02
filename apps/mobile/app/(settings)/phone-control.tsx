import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, AppState, ScrollView, StyleSheet } from "react-native";
import {
  SettingsFooter,
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
  useStackedSettings,
} from "../../components/settings-group";
import { useI18n } from "../../lib/i18n";
import { native, useThemedStyles } from "../../lib/native";
import type { PhoneControlState } from "../../lib/phone-control";
import {
  allowTermux,
  getPhoneControlState,
  openAccessibilitySettings,
  PHONE_IDLE_MINUTES,
  removePhone,
  setPhoneIdleMinutes,
  turnOffPhoneControl,
  turnOnPhoneControl,
} from "../../lib/phone-control";
import { useSideInsets } from "../../lib/side-insets";
import { errorText } from "../../lib/user-error";

export default function PhoneControl() {
  const sideInsets = useSideInsets();
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const stacked = useStackedSettings();
  const [state, setState] = useState<PhoneControlState | null>(null);
  const [pending, setPending] = useState(false);

  useFocusEffect(
    useCallback(() => {
      const refresh = () => void getPhoneControlState().then(setState, () => undefined);
      refresh();
      const timer = setInterval(refresh, 2_000);
      const listener = AppState.addEventListener("change", (status) => {
        if (status === "active") refresh();
      });
      return () => {
        clearInterval(timer);
        listener.remove();
      };
    }, []),
  );

  function run(action: () => Promise<PhoneControlState>) {
    setPending(true);
    void action()
      .then(setState)
      .catch((cause: unknown) => Alert.alert(t("Phone control"), errorText(cause)))
      .finally(() => setPending(false));
  }

  function chooseIdle() {
    Alert.alert(t("Turn off after"), undefined, [
      ...PHONE_IDLE_MINUTES.map((minutes) => ({
        text: t("{count} min", { count: minutes }),
        onPress: () => run(() => setPhoneIdleMinutes(minutes)),
      })),
      { text: t("Cancel"), style: "cancel" as const },
    ]);
  }

  function confirmRemove() {
    Alert.alert(
      t("Remove this phone?"),
      t("Bots lose access to this phone until you turn Phone control on again."),
      [
        { text: t("Cancel"), style: "cancel" },
        { text: t("Remove"), style: "destructive", onPress: () => run(removePhone) },
      ],
    );
  }

  if (!state) return <ActivityIndicator style={styles.loading} />;
  return (
    <ScrollView
      style={[styles.screen, sideInsets]}
      contentContainerStyle={[styles.container, stacked && styles.compactContainer]}
      contentInsetAdjustmentBehavior="automatic"
    >
      <SettingsGroup
        footer={t(
          "Lets your bots see and control this phone and run commands on it while this is on. Every action is logged.",
        )}
      >
        <SettingsSwitch
          label={t("Phone control")}
          detail={
            state.enabled ? (state.connected ? t("Connected") : t("Not connected")) : undefined
          }
          disabled={pending}
          value={state.enabled}
          onChange={(on) => run(on ? turnOnPhoneControl : turnOffPhoneControl)}
        />
        <SettingsRow
          accessibilityRole="button"
          chevron="right"
          title={t("Accessibility")}
          value={state.accessibility ? t("On") : t("Off")}
          onPress={() => void openAccessibilitySettings()}
        />
        <SettingsRow
          accessibilityRole="button"
          chevron="right"
          disabled={pending}
          title={t("Turn off after")}
          value={t("{count} min", { count: state.idleMinutes })}
          onPress={chooseIdle}
        />
        {state.termuxInstalled ? (
          <SettingsRow
            accessibilityRole="button"
            disabled={state.termuxAllowed}
            title="Termux"
            value={state.termuxAllowed ? t("Allowed") : t("Allow")}
            onPress={() => void allowTermux()}
          />
        ) : null}
      </SettingsGroup>
      {!state.accessibility ? (
        <SettingsFooter>
          {t(
            "Turn on Atlas phone control in Accessibility settings to let bots see and tap the screen.",
          )}
        </SettingsFooter>
      ) : null}
      {!state.screenshots ? (
        <SettingsFooter>{t("Screenshots need Android 11 or newer.")}</SettingsFooter>
      ) : null}
      {state.paired ? (
        <SettingsGroup>
          <SettingsRow
            accessibilityRole="button"
            destructive
            dimmed={pending}
            disabled={pending}
            onPress={confirmRemove}
            title={t("Remove this phone")}
          />
        </SettingsGroup>
      ) : null}
    </ScrollView>
  );
}

function createStyles() {
  return StyleSheet.create({
    loading: { flex: 1 },
    screen: { flex: 1, backgroundColor: native.groupedPage },
    container: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32, gap: 28 },
    compactContainer: { paddingHorizontal: 8 },
  });
}
