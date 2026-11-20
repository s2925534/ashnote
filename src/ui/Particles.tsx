// Particle effects for messages: they form out of particles when they arrive and
// dissolve into drifting particles (or burst, on a double-tap) when they are deleted.
// Uses React Native's Animated API on the native driver, so it stays smooth.
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

type Mode = "drift" | "burst" | "form";
const COLS = 10;
const ROWS = 14;

export function Particles({ width, height, colors, mode, onDone }: {
  width: number; height: number; colors: [string, string]; mode: Mode; onDone?: () => void;
}) {
  const cells = useMemo(() => {
    const out: { x: number; y: number; size: number; color: string; dx: number; dy: number; delay: number }[] = [];
    const cw = width / COLS, ch = height / ROWS;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const x = c * cw + Math.random() * cw * 0.3, y = r * ch + Math.random() * ch * 0.3;
      const size = Math.min(cw, ch) * (0.45 + Math.random() * 0.45);
      const color = Math.random() < 0.2 ? colors[1] : colors[0];
      let dx = 0, dy = 0, delay = 0;
      if (mode === "burst") {
        const a = Math.atan2(y - height / 2, x - width / 2) + (Math.random() - 0.5) * 0.8;
        const d = 60 + Math.random() * 160;
        dx = Math.cos(a) * d; dy = Math.sin(a) * d - 30; delay = Math.random() * 40;
      } else if (mode === "drift") {
        dx = (Math.random() - 0.35) * 50; dy = -(60 + Math.random() * 160); delay = (x / width) * 340 + Math.random() * 120;
      } else {
        const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 110;
        dx = Math.cos(a) * d; dy = Math.sin(a) * d - 20; delay = Math.random() * 120;
      }
      out.push({ x, y, size, color, dx, dy, delay });
    }
    return out;
  }, [width, height, mode, colors]);

  const values = useRef(cells.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const duration = mode === "burst" ? 520 : mode === "drift" ? 1100 : 480;
    Animated.parallel(
      values.map((v, i) =>
        Animated.timing(v, {
          toValue: 1,
          duration: duration + Math.random() * 300,
          delay: cells[i].delay,
          easing: mode === "form" ? Easing.out(Easing.cubic) : Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ),
    ).start(() => onDone?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "visible" }]}>
      {cells.map((p, i) => {
        const v = values[i];
        const forming = mode === "form";
        const style = {
          position: "absolute" as const,
          left: p.x, top: p.y, width: p.size, height: p.size, backgroundColor: p.color,
          opacity: forming ? v.interpolate({ inputRange: [0, 0.3, 0.85, 1], outputRange: [0, 1, 1, 0] })
            : v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          transform: [
            { translateX: v.interpolate({ inputRange: [0, 1], outputRange: forming ? [p.dx, 0] : [0, p.dx] }) },
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: forming ? [p.dy, 0] : [0, p.dy] }) },
            { scale: v.interpolate({ inputRange: [0, 1], outputRange: forming ? [0.6, 1] : [1, 0.35] }) },
          ],
        };
        return <Animated.View key={i} style={style} />;
      })}
    </View>
  );
}

/** Scrambles text into ciphertext-looking characters and decodes it letter by letter. */
export const GLYPHS = "abcdef0123456789+/=#%&$@";
export function scramble(text: string, revealed: number): string {
  let s = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    s += i < revealed || ch === " " || ch === "\n" ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
  }
  return s;
}
