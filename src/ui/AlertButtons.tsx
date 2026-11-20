// SOS and Help buttons. Hold for one second to send, so a pocket tap never sends one by
// accident; letting go early cancels. The location is looked up and sent with the alert.
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useEngine } from "../lib/engine";
import { allowLocation, currentLocation, locationStatus } from "../lib/location";
import { Button, Dialog } from "./kit";
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
  const [askHelp, setAskHelp] = useState(false);
  const [perm, setPerm] = useState<"granted" | "denied" | "undetermined" | null>(null);
  useEffect(() => { locationStatus().then(setPerm); }, []);

  // SOS sends the location straight away, by design. Help asks first.
  const fire = (level: "sos" | "help") => {
    if (busy || !contactIds.length) return;
    if (level === "help") { setAskHelp(true); return; }
    send("sos", true);
  };
  const send = async (level: "sos" | "help", withLocation: boolean) => {
    setAskHelp(false);
    setBusy(true);
    Haptics.notificationAsync(level === "sos" ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Warning).catch(() => {});
    const loc = withLocation ? await currentLocation() : null;
    const n = await engine.sendAlert(contactIds, level, loc, withLocation);
    setBusy(false);
    onSent?.(`${level === "sos" ? "SOS" : "Help request"} sent to ${n === 1 ? "1 contact" : `${n} contacts`}${loc ? " with your location" : withLocation ? ". Your location wasn't available" : " without your location"}.`);
  };
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <HoldButton label="SOS" sub="Life-threatening" color={theme.danger} disabled={busy || !contactIds.length} onFire={() => fire("sos")} />
        <HoldButton label="Help" sub="Not an emergency" color={theme.amber} disabled={busy || !contactIds.length} onFire={() => fire("help")} />
      </View>
      <Text style={[styles.note, { color: theme.muted }]}>
        {busy ? "Sending…" : `Hold to alert ${scope}. SOS always includes your location; Help asks first. Ashnote doesn't contact emergency services: in danger, call your local emergency number (000 in Australia).`}
      </Text>
      {perm === "undetermined" && (
        <Button label="Allow location so SOS can include it" theme={theme} onPress={async () => { await allowLocation(); setPerm(await locationStatus()); }} />
      )}
      {perm === "denied" && (
        <Text style={[styles.note, { color: theme.danger }]}>Location is off for Ashnote, so SOS will be sent without it. Turn it on in your phone's settings.</Text>
      )}
      <Dialog visible={askHelp} onClose={() => setAskHelp(false)} theme={theme} title="Share your location?">
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
          Send your current location with this help request? It goes encrypted to {scope} only.
        </Text>
        <Button label="Share location" primary theme={theme} onPress={() => send("help", true)} />
        <Button label="Send without location" theme={theme} onPress={() => send("help", false)} />
        <Button label="Cancel" theme={theme} onPress={() => setAskHelp(false)} />
      </Dialog>
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
