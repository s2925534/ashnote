// A subtle vertical gradient behind dialog content, drawn with react-native-svg.
import { useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

export function LinearGradientLike({ from, to, style, children }: { from: string; to: string; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const [s, setS] = useState({ w: 0, h: 0 });
  return (
    <View style={[style, { overflow: "hidden" }]} onLayout={(e) => setS({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {s.w > 0 && (
        <Svg style={StyleSheet.absoluteFill} width={s.w} height={s.h}>
          <Defs>
            <LinearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor={to} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={s.w} height={s.h} fill="url(#g)" />
        </Svg>
      )}
      {children}
    </View>
  );
}
