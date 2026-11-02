import { Image } from "react-native";
import appMark from "../assets/monochrome-icon.png";
import { native, useResolvedAppearance } from "../lib/native";

const DEFAULT_MARK = 56;

/** The Atlas mountain, tinted like text. No plate or crop around it. */
export function AppMark({ size = DEFAULT_MARK }: { size?: number }) {
  useResolvedAppearance();
  return (
    <Image
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      source={appMark}
      style={{ width: size, height: size, tintColor: native.label }}
    />
  );
}
