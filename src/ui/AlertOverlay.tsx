// A received SOS or Help takes over the screen wherever you are in the app, with a strong
// vibration, the sender's location and a way straight into the chat.
import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, Vibration, View } from "react-native";
import type { Msg } from "../core/engine";
import { describeLocation, openInMaps } from "../lib/maps";
import { Icon } from "./Icon";

export function AlertOverlay({ msg, from, now, onOpenChat, onClose }: {
  msg: Msg; from: string; now: number; onOpenChat: () => void; onClose: () => void;
}) {
  const sos = msg.alert?.level === "sos";
  useEffect(() => {
    Vibration.vibrate(sos ? [0, 600, 250, 600, 250, 600] : [0, 300, 200, 300]);
    return () => Vibration.cancel();
  }, [sos]);
  const loc = msg.alert?.loc ?? null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: sos ? "#b3261e" : "#a35a00" }]} accessibilityViewIsModal accessibilityLiveRegion="assertive">
        <Text style={styles.big}>{sos ? "SOS" : "HELP"}</Text>
        <Text style={styles.from}>from {from}</Text>
        <Text style={styles.text}>{msg.text}</Text>
        <Text style={styles.loc}>{describeLocation(loc, now, msg.alert?.shared !== false)}</Text>
        {loc && (
          <Pressable accessibilityRole="button" onPress={() => openInMaps(loc)} style={[styles.btn, styles.primary]}>
            <Icon name="pin" color="#b3261e" size={20} />
            <Text style={[styles.btnText, { color: "#b3261e" }]}>Open in maps</Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" onPress={onOpenChat} style={styles.btn}>
          <Text style={styles.btnText}>Open the chat</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.btn}>
          <Text style={styles.btnText}>Close</Text>
        </Pressable>
        {sos && <Text style={styles.note}>If they're in danger, call your local emergency number (000 in Australia).</Text>}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 },
  big: { color: "#fff", fontSize: 72, fontWeight: "900", letterSpacing: 6 },
  from: { color: "#fff", fontSize: 20, fontWeight: "700" },
  text: { color: "#fff", fontSize: 17, textAlign: "center" },
  loc: { color: "#fff", opacity: 0.9, fontSize: 13, textAlign: "center" },
  btn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff", borderRadius: 14,
    paddingVertical: 14, alignSelf: "stretch", maxWidth: 360, width: "100%" },
  primary: { backgroundColor: "#fff" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  note: { color: "#fff", opacity: 0.85, fontSize: 12, textAlign: "center", marginTop: 6 },
});
