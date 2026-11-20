// One message, filling the space above the message box.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import type { Msg } from "../core/engine";
import { Particles, scramble } from "./Particles";
import type { Theme } from "./theme";

export type Enter = "arrive" | "lift" | "rise" | "none";
export type Leave = "drift" | "burst";

const fontSizeFor = (n: number) => (n <= 16 ? 34 : n <= 40 ? 27 : n <= 90 ? 21 : n <= 150 ? 18 : 16);

export function MessageCard({ msg, from, now, theme, reduceMotion, enter, leave, onDoubleTap, onRevealed, onGone }: {
  msg: Msg; from: string; now: number; theme: Theme; reduceMotion: boolean;
  enter: Enter; leave?: Leave | null;
  onDoubleTap?: () => void; onRevealed?: () => void; onGone?: () => void;
}) {
  const mine = msg.side === "mine";
  const bg = mine ? theme.accent : theme.theirs;
  const fg = mine ? theme.accentInk : theme.theirsInk;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [text, setText] = useState(enter === "arrive" || (enter === "rise" && !mine && msg.readAt == null) ? scramble(msg.text, 0) : msg.text);
  const [forming, setForming] = useState(false);
  const [burst, setBurst] = useState<Leave | null>(null);
  const opacity = useRef(new Animated.Value(enter === "none" ? 1 : 0)).current;
  const shift = useRef(new Animated.Value(enter === "lift" ? 24 : 0)).current;
  const scale = useRef(new Animated.Value(enter === "rise" ? 0.9 : enter === "lift" ? 0.94 : 1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const lastTap = useRef(0);

  const decode = (done: () => void) => {
    if (reduceMotion) { setText(msg.text); done(); return; }
    const start = Date.now(), dur = 650;
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / dur);
      setText(scramble(msg.text, Math.floor(k * msg.text.length)));
      if (k >= 1) { clearInterval(id); setText(msg.text); done(); }
    }, 30);
  };

  // entering
  useEffect(() => {
    if (!size || leave) return;
    const reveal = () => onRevealed?.();
    if (enter === "none") { reveal(); return; }
    if (reduceMotion) {
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start(() => { setText(msg.text); reveal(); });
      shift.setValue(0); scale.setValue(1);
      return;
    }
    if (enter === "arrive") {
      setForming(true);
      setTimeout(() => {
        Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: true }).start();
        decode(reveal);
      }, 420);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(shift, { toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      if (enter === "rise" && !mine && msg.readAt == null) decode(reveal); else reveal();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size == null]);

  // leaving: scramble back to ciphertext, then break into particles
  useEffect(() => {
    if (!leave) return;
    if (reduceMotion || !size) {
      Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }).start(() => onGone?.());
      return;
    }
    const start = Date.now(), dur = leave === "burst" ? 110 : 260;
    const id = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / dur);
      setText(scramble(msg.text, Math.floor((1 - k) * msg.text.length)));
      if (k >= 1) { clearInterval(id); opacity.setValue(0); setText(""); setBurst(leave); }
    }, 30);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leave]);

  // countdown
  const frac = msg.expiresAt != null && msg.eff ? Math.max(0, (msg.expiresAt - now) / msg.eff) : null;
  const fading = frac != null && frac < 0.15 && !reduceMotion && !leave;
  useEffect(() => {
    if (!fading) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.7, duration: 600, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [fading, pulse]);

  const onPress = () => {
    const t = Date.now();
    if (t - lastTap.current < 320) { lastTap.current = 0; onDoubleTap?.(); } else lastTap.current = t;
  };

  const perimeter = size ? 2 * (size.w + size.h) - (8 - 2 * Math.PI) * 26 : 0;

  return (
    <View style={styles.wrap} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: Animated.multiply(opacity, pulse), transform: [{ translateY: shift }, { scale }] }]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Message from ${from}: ${msg.text}`}
          accessibilityHint="Double-tap with one finger to delete it now on both phones."
          accessibilityActions={[{ name: "delete", label: "Delete now" }]}
          onAccessibilityAction={(e) => e.nativeEvent.actionName === "delete" && onDoubleTap?.()}
          style={[styles.card, { backgroundColor: bg }, fading && { opacity: 0.85 }]}
        >
          <Text style={[styles.from, { color: fg }]}>{mine ? "YOU" : from.toUpperCase()}</Text>
          <Text selectable={false} style={[styles.text, { color: fg, fontSize: fontSizeFor(msg.text.length), lineHeight: fontSizeFor(msg.text.length) * 1.3 }]}>
            {text}
          </Text>
        </Pressable>
        {size && frac != null && (
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={size.w} height={size.h}>
            <Rect x={1.5} y={1.5} width={size.w - 3} height={size.h - 3} rx={26} ry={26} fill="none" stroke={theme.amber}
              strokeWidth={3} strokeDasharray={`${perimeter}`} strokeDashoffset={perimeter * (1 - frac)} />
          </Svg>
        )}
      </Animated.View>
      {size && forming && <Particles width={size.w} height={size.h} colors={[bg, fg]} mode="form" onDone={() => setForming(false)} />}
      {size && burst && <Particles width={size.w} height={size.h} colors={[bg, fg]} mode={burst} onDone={() => onGone?.()} />}
    </View>
  );
}

export function metaLine(msg: Msg, now: number): string {
  const left = (t: number) => {
    const s = Math.max(0, Math.ceil((t - now) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (s < 86400) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  };
  if (msg.side === "mine") {
    if (msg.status === "sending") return "Sending…";
    if (msg.status === "sent") return "Delivered to the relays, not read yet";
    if (msg.status === "read") return msg.expiresAt == null ? "Read · kept" : `Read · deletes in ${left(msg.expiresAt)}`;
    return "";
  }
  if (msg.readAt == null) return "";
  return msg.expiresAt == null ? "Kept" : `Deletes in ${left(msg.expiresAt)}`;
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  card: { flex: 1, borderRadius: 26, paddingHorizontal: 22, paddingVertical: 36, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  from: { position: "absolute", top: 14, left: 18, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, opacity: 0.75 },
  text: { textAlign: "center", fontWeight: "600" },
});
