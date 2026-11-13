import { useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { mobileTokens } from "../lib/appearance";
import { tapHaptic } from "../lib/haptics";
import { useI18n } from "../lib/i18n";
import { useThemedStyles } from "../lib/native";
import { iosAtLeast } from "../lib/native-controls";
import {
  getVoicePlaybackState,
  pauseVoicePlayback,
  resumeVoicePlayback,
  skipVoicePlayback,
  stopVoicePlayback,
  subscribeVoicePlayback,
} from "../lib/voice";
import { GlassSurface } from "./glass-surface";
import { NativeSymbol } from "./native-symbol";

/**
 * Pause / Resume / Stop for a reply that is being spoken. Rendered only while
 * something is speaking or paused, as a normal block in the layout so it never
 * covers the message list or composer, and it follows the user across screens
 * because playback state, including who is speaking, lives in `lib/voice`.
 */
export function VoicePlayerBar({
  style,
}: {
  style?: { marginTop?: number; marginBottom?: number; marginHorizontal?: number };
}) {
  const { t } = useI18n();
  const styles = useThemedStyles(createStyles);
  const tokens = mobileTokens();
  const playback = useSyncExternalStore(subscribeVoicePlayback, getVoicePlaybackState);
  if (playback.status === "idle") return null;

  const speakerColor = playback.speaker?.color ?? tokens.foreground;
  const paused = playback.status === "paused";
  // Stop works from the first moment; until the first clip is ready there is nothing to pause.
  const preparing = playback.status === "playing" && !playback.canPause;
  const name = playback.speaker?.name || t("Bot");
  const detail = playback.interrupted
    ? t("Paused while another app uses audio")
    : preparing
      ? t("Getting ready…")
      : null;

  return (
    <GlassSurface style={[styles.bar, style]} fallbackStyle={styles.barFallback}>
      <View
        accessible
        accessibilityLabel={detail ? `${name}, ${detail}` : t("{name} is speaking", { name })}
        accessibilityLiveRegion="polite"
        style={styles.who}
      >
        {preparing ? (
          <ActivityIndicator size="small" color={speakerColor} style={styles.indicator} />
        ) : (
          <NativeSymbol
            ios={paused ? "pause.circle" : "waveform"}
            android={paused ? "pause-circle-outline" : "pulse-outline"}
            size={16}
            color={speakerColor}
          />
        )}
        <View style={styles.copy}>
          <Text numberOfLines={1} style={[styles.name, { color: speakerColor }]}>
            {name}
          </Text>
          {detail ? (
            <Text numberOfLines={1} style={styles.detail}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      {paused ? (
        <VoiceControlButton
          accessibilityLabel={t("Play")}
          onPress={resumeVoicePlayback}
          ios="play.fill"
          android="play"
        />
      ) : playback.canPause ? (
        <VoiceControlButton
          accessibilityLabel={t("Pause")}
          onPress={pauseVoicePlayback}
          ios="pause.fill"
          android="pause"
        />
      ) : null}
      {playback.canSkip ? (
        <VoiceControlButton
          accessibilityLabel={t("Next")}
          onPress={skipVoicePlayback}
          ios="forward.end.fill"
          android="play-skip-forward"
        />
      ) : null}
      <VoiceControlButton
        accessibilityLabel={t("Stop")}
        onPress={stopVoicePlayback}
        ios="stop.fill"
        android="stop"
      />
    </GlassSurface>
  );
}

function VoiceControlButton({
  accessibilityLabel,
  onPress,
  ios,
  android,
}: {
  accessibilityLabel: string;
  onPress: () => void;
  ios: string;
  android: Parameters<typeof NativeSymbol>[0]["android"];
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // The circle is drawn at 34pt; the touch target reaches the 44pt minimum.
      hitSlop={5}
      onPress={() => {
        tapHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        !iosAtLeast(26) && styles.buttonFallback,
        pressed && { opacity: 0.6 },
      ]}
    >
      <NativeSymbol ios={ios} android={android} size={14} color={mobileTokens().foreground} />
    </Pressable>
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
      paddingHorizontal: 16,
    },
    barFallback: {
      borderRadius: 18,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: tokens.glassStroke,
      backgroundColor: tokens.glassFill,
    },
    who: { flexGrow: 1, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 10 },
    indicator: { width: 16, height: 16, transform: [{ scale: 0.7 }] },
    copy: { flexShrink: 1 },
    name: { fontSize: 13, fontWeight: "600" },
    detail: { fontSize: 12, color: tokens.mutedForeground },
    button: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonFallback: {
      borderWidth: 1,
      borderColor: tokens.border,
      backgroundColor: tokens.background,
    },
  });
}
