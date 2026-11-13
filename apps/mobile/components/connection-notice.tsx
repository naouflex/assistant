import { useEffect } from "react";
import { AppState } from "react-native";
import { isServerReachable, probeServerReachable, subscribeServerReachable } from "../lib/api";
import { dismissAppNotice, showAppNotice } from "../lib/app-notice";
import { BACK_ONLINE_NOTICE_MS, createConnectionNotice } from "../lib/connection-notice";
import { notifyHaptic } from "../lib/haptics";
import { t } from "../lib/i18n";

/** Mounted once in the root layout: tells the user when Atlas cannot be reached, and when it can again. */
export function ConnectionNotice(): null {
  useEffect(() => {
    const watcher = createConnectionNotice({
      isReachable: isServerReachable,
      subscribe: subscribeServerReachable,
      probe: () => probeServerReachable(),
      showOffline: () =>
        showAppNotice({
          tone: "warning",
          message: t("Can't reach Atlas. Retrying…"),
          durationMs: 0,
          action: { label: t("Retry"), onPress: () => void probeServerReachable() },
        }),
      showBackOnline: () => {
        notifyHaptic("success");
        return showAppNotice({ message: t("Back online"), durationMs: BACK_ONLINE_NOTICE_MS });
      },
      dismiss: dismissAppNotice,
      isActive: () => AppState.currentState === "active",
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") watcher.resumed();
    });
    return () => {
      subscription.remove();
      watcher.dispose();
    };
  }, []);
  return null;
}
