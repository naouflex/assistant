import { useEffect, useRef, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { dismissAppNotice, getAppNotice, subscribeAppNotice } from "../lib/app-notice";
import { mobileTokens } from "../lib/appearance";
import { tapHaptic } from "../lib/haptics";
import { useI18n } from "../lib/i18n";
import { useThemedStyles } from "../lib/native";
import { GlassSurface } from "./glass-surface";
import { NativeSymbol } from "./native-symbol";

/**
 * The notice from `lib/app-notice`, as a block above the voice dock: like the dock it never
 * covers the message list or composer, and it follows the user across screens.
 */
export function AppNoticeHost({
  style,
}: {
  style?: { marginTop?: number; marginBottom?: number };
}) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const tokens = mobileTokens();
  const notice = useSyncExternalStore(subscribeAppNotice, getAppNotice, getAppNotice);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!notice) return;
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    // Screen readers hear it even when focus is elsewhere.
    AccessibilityInfo.announceForAccessibility?.(notice.message);
  }, [notice, opacity]);

  if (!notice) return null;
  const warning = notice.tone === "warning";
  return (
    <Animated.View style={[{ opacity }, style]}>
      <GlassSurface style={styles.bar} fallbackStyle={styles.barFallback}>
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.body}>
          <NativeSymbol
            ios={warning ? "exclamationmark.triangle.fill" : "info.circle.fill"}
            android={warning ? "warning-outline" : "information-circle-outline"}
            size={16}
            color={warning ? tokens.warning : tokens.mutedForeground}
          />
          <Text style={styles.message} numberOfLines={3}>
            {notice.message}
          </Text>
        </View>
        {notice.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={notice.action.label}
            hitSlop={8}
            onPress={() => {
              tapHaptic();
              const action = notice.action;
              dismissAppNotice(notice.id);
              action?.onPress();
            }}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.actionText}>{notice.action.label}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Dismiss")}
          hitSlop={10}
          onPress={() => dismissAppNotice(notice.id)}
          style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
        >
          <NativeSymbol ios="xmark" android="close" size={13} color={tokens.mutedForeground} />
        </Pressable>
      </GlassSurface>
    </Animated.View>
  );
}

function createStyles() {
  const tokens = mobileTokens();
  return StyleSheet.create({
    bar: {
      marginHorizontal: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      paddingLeft: 14,
      paddingRight: 8,
    },
    barFallback: {
      borderRadius: 18,
      borderWidth: 1,
      borderColor: tokens.glassStroke,
      backgroundColor: tokens.glassFill,
    },
    body: { flexDirection: "row", alignItems: "center", gap: 10, flexGrow: 1, flexShrink: 1 },
    message: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: tokens.foreground },
    action: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 },
    actionText: { fontSize: 13, fontWeight: "600", color: tokens.primary },
    close: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  });
}
