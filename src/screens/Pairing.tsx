// Invite, scan and verify: the three steps of adding a contact.
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useEngine } from "../lib/engine";
import { Button } from "../ui/kit";
import type { Theme } from "../ui/theme";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function InviteScreen({ theme, onCancel }: { theme: Theme; onCancel: () => void }) {
  const { engine, now } = useEngine();
  const [inv, setInv] = useState<ReturnType<typeof engine.createInvite> | null>(null);
  useEffect(() => { setInv(engine.createInvite()); }, [engine]);
  if (!inv) return <View style={styles.pane} />;
  const left = inv.invite.expiresAt - now;
  return (
    <View style={styles.pane}>
      <Text accessibilityRole="header" style={[styles.h, { color: theme.ink }]}>Invite code</Text>
      <View style={styles.qr} accessibilityLabel="Single-use invite code">
        <QRCode value={inv.code} size={240} backgroundColor="#ffffff" color="#141824" ecl="M" />
      </View>
      <Text style={[styles.count, { color: left < 60_000 ? theme.amber : theme.ink }]}>Expires in {mmss(left)}</Text>
      {Platform.OS === "web" && (
        <Text selectable testID="invite-code" style={{ color: theme.muted, fontSize: 10, maxWidth: 300 }} numberOfLines={2}>{inv.code}</Text>
      )}
      <Text style={[styles.p, { color: theme.muted }]}>
        Let the other person scan this with Ashnote. It holds a one-off key, not your identity, and works once.
      </Text>
      <Button label="Cancel invite" theme={theme} style={styles.wide} onPress={() => { engine.cancelInvite(inv.invite.pub); onCancel(); }} />
    </View>
  );
}

export function ScanScreen({ theme, onScanned, onCancel }: { theme: Theme; onScanned: (safety: string[]) => void; onCancel: () => void }) {
  const { engine } = useEngine();
  const [perm, request] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const busy = useRef(false);

  const tryCode = async (code: string) => {
    if (busy.current) return;
    busy.current = true;
    const r = await engine.scan(code.trim());
    if (r.ok) onScanned(r.safety);
    else { setError(r.reason); setTimeout(() => (busy.current = false), 1500); }
  };

  if (Platform.OS === "web") {
    return (
      <View style={styles.pane}>
        <Text style={[styles.h, { color: theme.ink }]}>Scan a code</Text>
        <Text style={[styles.p, { color: theme.muted }]}>Preview build: paste the code text instead of scanning.</Text>
        <TextInput value={manual} onChangeText={setManual} placeholder="ashnote:1:…" placeholderTextColor={theme.muted}
          style={[styles.input, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.panel }]} />
        {error && <Text style={{ color: theme.danger }}>{error}</Text>}
        <Button label="Use code" primary theme={theme} style={styles.wide} onPress={() => tryCode(manual)} />
        <Button label="Back" theme={theme} style={styles.wide} onPress={onCancel} />
      </View>
    );
  }
  if (!perm) return <View style={styles.pane} />;
  if (!perm.granted) {
    return (
      <View style={styles.pane}>
        <Text style={[styles.h, { color: theme.ink }]}>Camera needed</Text>
        <Text style={[styles.p, { color: theme.muted }]}>Ashnote uses the camera only to scan invite codes. Nothing is recorded or sent.</Text>
        <Button label="Allow camera" primary theme={theme} style={styles.wide} onPress={request} />
        <Button label="Back" theme={theme} style={styles.wide} onPress={onCancel} />
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <CameraView style={styles.fill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(e) => tryCode(e.data)} />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.frame, { borderColor: theme.accent }]} />
        <Text style={styles.overlayText}>{error ?? "Point the camera at the other phone's code."}</Text>
        <Button label="Cancel" theme={theme} style={styles.wide} onPress={onCancel} />
      </View>
    </View>
  );
}

export function VerifyScreen({ theme, role, safety, invitePub, onDone }: {
  theme: Theme; role: "host" | "guest"; safety: string[]; invitePub?: string; onDone: () => void;
}) {
  const { engine } = useEngine();
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaitedLong(true), 20_000); return () => clearTimeout(t); }, []);
  return (
    <View style={styles.pane}>
      <Text accessibilityRole="header" style={[styles.h, { color: theme.ink }]}>Check the symbols</Text>
      <Text style={styles.emoji} accessibilityLabel={`Safety code: ${safety.join(" ")}`}>{safety.join("  ")}</Text>
      <Text style={[styles.p, { color: theme.muted }]}>
        Both phones must show the same 4 symbols. If they don't, someone else scanned the code.
      </Text>
      {role === "host" ? (
        <>
          <Button label="They match, accept" primary theme={theme} style={styles.wide} onPress={() => invitePub && engine.acceptRequest(invitePub)} />
          <Button label="Don't match, reject" theme={theme} style={styles.wide} onPress={() => { if (invitePub) engine.rejectRequest(invitePub); onDone(); }} />
        </>
      ) : (
        <>
          <Text style={[styles.p, { color: theme.muted }]}>Waiting for the other phone to accept…</Text>
          {waitedLong && <Button label="Stop waiting" theme={theme} style={styles.wide} onPress={onDone} />}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pane: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  h: { fontSize: 24, fontWeight: "700" },
  p: { fontSize: 15, textAlign: "center", lineHeight: 22, maxWidth: 340 },
  qr: { padding: 14, backgroundColor: "#fff", borderRadius: 16 },
  count: { fontSize: 15, fontVariant: ["tabular-nums"] },
  wide: { alignSelf: "stretch", maxWidth: 340, width: "100%" },
  emoji: { fontSize: 42, letterSpacing: 4 },
  input: { alignSelf: "stretch", borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 24, padding: 28 },
  frame: { width: 240, height: 240, borderWidth: 3, borderRadius: 22 },
  overlayText: { color: "#fff", fontSize: 15, textAlign: "center", textShadowColor: "#000", textShadowRadius: 6 },
});
