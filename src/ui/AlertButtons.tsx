// SOS and Help buttons. Hold for one second to send, so a pocket tap never sends one by
// accident; letting go early cancels. The location is looked up and sent with the alert.
import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useEngine } from "../lib/engine";
import { currentLocation } from "../lib/location";
import type { Theme } from "./theme";

const HOLD_MS = 1000;

function HoldButton({ label, sub, color, onFire, disabled }: { label: string; sub: string; color: string; onFire: () => void; disabled?: boolean }) {
  const fill = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const start = () => {
    if (disabled) return;
    Haptics.selectionAsync().catch(() => {});
    anim.current = Animated.timing(fill, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false });
    anim.current.start(({ finished }) => {
      if (finished) { fill.setValue(0); onFire(); }
    });
  };
  const cancel = () => {
    anim.current?.stop();
    Animated.timing(fill, { toValue: 0, duration: 150, useNativeDriver: false }).start();
  };
  return (
    <Pressable onPressIn={start} onPressOut={cancel} disabled={disabled}
      accessibilityRole="button" accessibilityLabel={`${label}: ${sub}`} accessibilityHint="Hold for one second to send."
      accessibilityActions={[{ name: "activate", label: `Send ${label}` }]} onAccessibilityAction={() => onFire()}
      style={[styles.btn, { borderColor: color, opacity: disabled ? 0.5 : 1 }]}>
      <Animated.View style={[styles.fill, { backgroundColor: color, width: fill.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
      <Text style={[styles.sub, { color }]}>{sub}</Text>
    </Pressable>
  );
}

export function AlertButtons({ theme, contactIds, scope, onSent }: {
  theme: Theme; contactIds: string[]; scope: string; onSent?: (msg: string) => void;
}) {
  const { engine } = useEngine();
  const [busy, setBusy] = useState(false);
  const fire = async (level: "sos" | "help") => {
    if (busy || !contactIds.length) return;
    setBusy(true);
    Haptics.notificationAsync(level === "sos" ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const loc = await currentLocation();
    const n = await engine.sendAlert(contactIds, level, loc);
    setBusy(false);
    onSent?.(`${level === "sos" ? "SOS" : "Help request"} sent to ${n === 1 ? "1 contact" : `${n} contacts`}${loc ? " with your location" : ". Your location wasn't available"}.`);
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <HoldButton label="SOS" sub="Life-threatening" color={theme.danger} disabled={busy || !contactIds.length} onFire={() => fire("sos")} />
        <HoldButton label="Help" sub="Not an emergency" color={theme.amber} disabled={busy || !contactIds.length} onFire={() => fire("help")} />
      </View>
      <Text style={[styles.note, { color: theme.muted }]}>
        {busy ? "Finding your location and sending…" : `Hold to send your location to ${scope}. Ashnote doesn't contact emergency services: in danger, call your local emergency number (000 in Australia).`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: "row", gap: 10 },
  btn: { flex: 1, borderWidth: 2, borderRadius: 14, paddingVertical: 10, alignItems: "center", overflow: "hidden", minHeight: 58, justifyContent: "center" },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.25 },
  label: { fontSize: 18, fontWeight: "800", letterSpacing: 1 },
  sub: { fontSize: 11, fontWeight: "600" },
  note: { fontSize: 11, textAlign: "center", lineHeight: 15 },
});
