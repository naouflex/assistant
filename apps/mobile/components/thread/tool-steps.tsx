import { useMobileTokens } from "../../lib/native";
import { useI18n } from "../../lib/i18n";
import { Text, View } from "react-native";

type ToolStep = { label: string; count: number; note?: string };

/** How many recent steps stay on screen while a run is still going. */
const LIVE_TOOL_STEP_WINDOW = 6;

/** The desktop tool list: the current step marked, earlier ones checked, long runs trimmed. */
export function LiveToolSteps({ steps }: { steps: readonly ToolStep[] }) {
  const tokens = useMobileTokens();
  const { t } = useI18n();
  if (steps.length === 0) return null;
  const hidden = steps.length > LIVE_TOOL_STEP_WINDOW ? steps.length - LIVE_TOOL_STEP_WINDOW : 0;
  const shown = hidden > 0 ? steps.slice(hidden) : steps;
  const toolCount = steps.reduce((total, step) => total + step.count, 0);
  return (
    <View accessibilityRole="text" style={{ gap: 2, paddingVertical: 2 }}>
      <Text style={{ color: tokens.foreground, fontSize: 13, fontWeight: "600" }}>
        {t("Working…")}
        {"  "}
        <Text style={{ color: tokens.mutedForeground, fontWeight: "500" }}>
          {t("{count} tools", { count: toolCount })}
        </Text>
      </Text>
      {hidden > 0 ? (
        <Text style={{ color: tokens.mutedForeground, fontSize: 12 }}>
          {t("+{count} earlier steps", { count: hidden })}
        </Text>
      ) : null}
      {shown.map((step, offset) => {
        const current = hidden + offset === steps.length - 1;
        return (
          <View key={`${hidden + offset}-${step.label}`} style={{ flexDirection: "row", gap: 8 }}>
            <Text style={{ color: current ? tokens.warning : tokens.success, fontSize: 12 }}>
              {current ? "◷" : "✓"}
            </Text>
            <Text
              numberOfLines={2}
              style={{
                flex: 1,
                color: current ? tokens.foreground : tokens.mutedForeground,
                fontSize: 13,
                fontWeight: current ? "600" : "400",
              }}
            >
              {step.label}
              {step.count > 1 ? ` ×${step.count}` : ""}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
