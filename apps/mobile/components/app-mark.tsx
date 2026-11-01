import { Image, StyleSheet, View } from "react-native";
import appMark from "../assets/monochrome-icon.png";
import { native, useResolvedAppearance } from "../lib/native";

const DEFAULT_MARK = 56;
// The face of the 1024 px monochrome icon: a 480 px circle inside the silhouette, eyes included.
const CROP = { x: 272, y: 303, size: 480 };

export function AppMark({ size = DEFAULT_MARK }: { size?: number }) {
  // Re-read tint when appearance flips; size is applied every render.
  useResolvedAppearance();
  const scale = size / CROP.size;
  const styles = StyleSheet.create({
    circle: {
      width: size,
      height: size,
      borderRadius: size / 2,
      overflow: "hidden",
      alignSelf: "center",
    },
    image: {
      position: "absolute",
      width: 1024 * scale,
      height: 1024 * scale,
      left: -CROP.x * scale,
      top: -CROP.y * scale,
      tintColor: native.label,
    },
  });
  return (
    <View
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.circle}
    >
      <Image source={appMark} style={styles.image} />
    </View>
  );
}
