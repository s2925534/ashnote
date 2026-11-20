import Svg, { Path, Rect } from "react-native-svg";
import type { Theme } from "./theme";

/** The Ashnote mark: a message bubble shedding a few particles. */
export function Mark({ size = 64, theme }: { size?: number; theme: Theme }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M10 14h34a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H24l-10 8v-8h-4a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z" fill={theme.accent} />
      <Rect x={52} y={10} width={4} height={4} fill={theme.amber} />
      <Rect x={58} y={4} width={3} height={3} fill={theme.amber} />
      <Rect x={56} y={18} width={3} height={3} fill={theme.amber} />
    </Svg>
  );
}
