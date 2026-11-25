// Invite, scan and verify: the three steps of adding a contact.
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, Animated, Easing, Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useEngine } from "../lib/engine";
import { Button, Pills } from "../ui/kit";
import { INVITE_LIFETIMES_MS, extractInviteCode, inviteLink } from "../core/invite";
import { Particles } from "../ui/Particles";
import type { Theme } from "../ui/theme";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

/** Invites this phone sent as a link: their symbol check happens on a call, not side by side. */
export const sharedInvites = new Set<string>();
const LIFETIME_LABELS = ["10 min", "1 hour", "24 hours"];

export function InviteScreen({ theme, onCancel }: { theme: Theme; onCancel: () => void }) {
  const { engine, now } = useEngine();
  const [inv, setInv] = useState<ReturnType<typeof engine.createInvite> | null>(null);
  useEffect(() => {
    const created = engine.createInvite();
    setInv(created);
    // Screenshot build only: the scripted second phone reads the code from the device log.
    if (process.env.EXPO_PUBLIC_SCREENSHOT_MODE === "1") console.log(`ASHNOTE_INVITE ${created.code}`);
  }, [engine]);
  const [life, setLife] = useState<number>(INVITE_LIFETIMES_MS[0]);
  if (!inv) return <View style={styles.pane} />;
  const left = inv.invite.expiresAt - now;
  const changeLife = (ms: number) => {
    const code = engine.setInviteLifetime(inv.invite.pub, ms);
    if (code) { setLife(ms); setInv({ invite: { ...inv.invite, expiresAt: engine.state.invites[inv.invite.pub].expiresAt }, code }); }
  };
  const share = async () => {
    const until = new Date(inv.invite.expiresAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    try {
      const r = await Share.share({ message: `Add me on Ashnote (works once, until ${until}): ${inviteLink(inv.code)}` });
      if (r.action !== Share.dismissedAction) sharedInvites.add(inv.invite.pub);
    } catch { /* share sheet closed */ }
  };
  return (
    <ScrollView contentContainerStyle={[styles.pane, { flexGrow: 1 }]}>
      <Text accessibilityRole="header" style={[styles.h, { color: theme.ink }]}>Invite code</Text>
      <View style={styles.qr} accessibilityLabel="Single-use invite code">
        <QRCode value={inv.code} size={220} backgroundColor="#ffffff" color="#141824" ecl="M" />
      </View>
      <Text style={[styles.count, { color: left < 60_000 ? theme.amber : theme.ink }]}>Expires in {mmss(left)}</Text>
      {Platform.OS === "web" && (
        <Text selectable testID="invite-code" style={{ color: theme.muted, fontSize: 10, maxWidth: 300 }} numberOfLines={2}>{inv.code}</Text>
      )}
      <Text style={[styles.p, { color: theme.muted }]}>
        Let the other person scan this with Ashnote. It holds a one-off key, not your identity, and works once.
      </Text>
      <Text style={[styles.label, { color: theme.muted }]}>Not together? Send it as a link</Text>
      <Pills label="Link lasts" theme={theme} value={life} onChange={changeLife}
        options={INVITE_LIFETIMES_MS.map((v, i) => ({ label: LIFETIME_LABELS[i], value: v }))} />
      <Button label="Share invite link" primary theme={theme} style={styles.wide} onPress={share} />
      <Button label="Cancel invite" theme={theme} style={styles.wide} onPress={() => { engine.cancelInvite(inv.invite.pub); onCancel(); }} />
    </ScrollView>
  );
}

export function ScanScreen({ theme, onScanned, onCancel }: { theme: Theme; onScanned: (safety: string[], expiresAt: number, remote: boolean) => void; onCancel: () => void }) {
  const { engine } = useEngine();
  const [perm, request] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const busy = useRef(false);

  const [pasting, setPasting] = useState(Platform.OS === "web");
  const tryCode = async (text: string, remote: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const code = extractInviteCode(text) ?? text.trim();
    const r = await engine.scan(code);
    if (r.ok) onScanned(r.safety, r.expiresAt, remote);
    else { setError(r.reason); setTimeout(() => (busy.current = false), 1500); }
  };

  if (pasting) {
    return (
      <View style={styles.pane}>
        <Text style={[styles.h, { color: theme.ink }]}>Paste a code</Text>
        <Text style={[styles.p, { color: theme.muted }]}>Paste the invite code or link someone sent you. Then call them to compare the 4 symbols.</Text>
        <TextInput value={manual} onChangeText={setManual} placeholder="ashnote:1:… or the invite link" placeholderTextColor={theme.muted} accessibilityLabel="Invite code" autoCorrect={false} autoCapitalize="none" multiline
          style={[styles.input, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.panel }]} />
        {error && <Text style={{ color: theme.danger }}>{error}</Text>}
        <Button label="Use code" primary theme={theme} style={styles.wide} onPress={() => tryCode(manual, true)} />
        {Platform.OS !== "web" && <Button label="Scan instead" theme={theme} style={styles.wide} onPress={() => { setError(null); setPasting(false); }} />}
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
        <Button label="Paste a code" theme={theme} style={styles.wide} onPress={() => setPasting(true)} />
        <Button label="Back" theme={theme} style={styles.wide} onPress={onCancel} />
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <CameraView style={styles.fill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(e) => tryCode(e.data, false)} />
      <View style={styles.overlay} pointerEvents="box-none">
        <View style={[styles.frame, { borderColor: theme.accent }]} />
        <Text style={styles.overlayText}>{error ?? "Point the camera at the other phone's code."}</Text>
        <Button label="Paste a code" theme={theme} style={styles.wide} onPress={() => { setError(null); setPasting(true); }} />
        <Button label="Cancel" theme={theme} style={styles.wide} onPress={onCancel} />
      </View>
    </View>
  );
}

export type PairOutcome = "pending" | "paired" | "expired";

/**
 * The 4 symbols show only while the invite code is valid. If nobody accepts in time, the code
 * is destroyed and the symbols explode; once paired they gather, glow and rise away.
 */
export function VerifyScreen({ theme, role, safety, invitePub, expiresAt, outcome, onDone, onFinished, remote = false }: {
  theme: Theme; role: "host" | "guest"; safety: string[]; invitePub?: string; expiresAt: number; remote?: boolean;
  outcome: PairOutcome; onDone: () => void; onFinished: () => void;
}) {
  const { engine, now } = useEngine();
  const [reduce, setReduce] = useState(false);
  const [row, setRow] = useState<{ w: number; h: number } | null>(null);
  const [burst, setBurst] = useState(false);
  const anims = useRef(safety.map(() => ({ s: new Animated.Value(1), x: new Animated.Value(0), y: new Animated.Value(0), o: new Animated.Value(1) }))).current;
  const glow = useRef(new Animated.Value(0)).current;
  const tick = useRef(new Animated.Value(0)).current;
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setReduce); }, []);

  useEffect(() => {
    if (outcome === "pending") return;
    const finish = () => setTimeout(onFinished, 250);
    if (reduce) {
      Animated.parallel(anims.map((a) => Animated.timing(a.o, { toValue: 0, duration: 250, useNativeDriver: true }))).start(finish);
      return;
    }
    if (outcome === "paired") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const spacing = (row?.w ?? 240) / safety.length;
      Animated.sequence([
        Animated.parallel([
          Animated.timing(glow, { toValue: 1, duration: 260, useNativeDriver: true }),
          ...anims.map((a) => Animated.spring(a.s, { toValue: 1.25, friction: 4, useNativeDriver: true })),
        ]),
        Animated.parallel(anims.map((a, i) => Animated.timing(a.x, { toValue: (safety.length / 2 - 0.5 - i) * spacing,
          duration: 380, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }))),
        Animated.parallel([
          ...anims.map((a, i) => Animated.timing(a.y, { toValue: -90 - i * 14, duration: 520, easing: Easing.in(Easing.quad), useNativeDriver: true })),
          ...anims.map((a) => Animated.timing(a.o, { toValue: 0, duration: 520, useNativeDriver: true })),
          Animated.spring(tick, { toValue: 1, friction: 5, useNativeDriver: true }),
        ]),
        Animated.delay(450),
      ]).start(finish);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setBurst(true);
      Animated.parallel(anims.map((a) => Animated.parallel([
        Animated.timing(a.s, { toValue: 1.7, duration: 160, useNativeDriver: true }),
        Animated.timing(a.o, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]))).start(() => setTimeout(onFinished, 1100));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  const left = expiresAt - now;
  const title = outcome === "paired" ? "Paired" : outcome === "expired" ? "Code expired" : "Check the symbols";
  return (
    <View style={styles.pane}>
      <Text accessibilityRole="header" style={[styles.h, { color: theme.ink }]}>{title}</Text>
      <View style={styles.symbolRow} onLayout={(e) => setRow({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        accessibilityLabel={`Safety code: ${safety.join(" ")}`}>
        <Animated.View pointerEvents="none" style={[styles.glow, { backgroundColor: theme.accent, opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }),
          transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.2] }) }] }]} />
        {safety.map((sym, i) => (
          <Animated.Text key={i} style={[styles.emoji, { opacity: anims[i].o, transform: [{ translateX: anims[i].x }, { translateY: anims[i].y }, { scale: anims[i].s }] }]}>
            {sym}
          </Animated.Text>
        ))}
        <Animated.View pointerEvents="none" style={[styles.tick, { backgroundColor: "#2fb36b", opacity: tick, transform: [{ scale: tick }] }]}>
          <Text style={styles.tickText}>✓</Text>
        </Animated.View>
        {burst && row && <Particles width={row.w} height={row.h} colors={[theme.amber, theme.danger]} mode="burst" />}
      </View>
      {outcome === "pending" && (
        <>
          <Text style={[styles.p, { color: theme.muted }]}>
            {remote
              ? "Not together? Call them and read the 4 symbols out loud. Accept only if all 4 match: if they don't, someone else used the link."
              : "You're next to each other: glance at the other phone. Both must show the same 4 symbols. If they don't, someone else scanned the code."}
          </Text>
          <Text style={[styles.count, { color: left < 60_000 ? theme.amber : theme.muted }]}>
            {role === "host" ? `Accept within ${mmss(left)}` : `Waiting for the other phone to accept · ${mmss(left)}`}
          </Text>
          {role === "host" ? (
            <>
              <Button label="They match, accept" primary theme={theme} style={styles.wide} onPress={() => invitePub && engine.acceptRequest(invitePub)} />
              <Button label="Don't match, reject" theme={theme} style={styles.wide} onPress={() => { if (invitePub) engine.rejectRequest(invitePub); onDone(); }} />
            </>
          ) : null}
        </>
      )}
      {outcome === "expired" && (
        <Text style={[styles.p, { color: theme.muted }]}>Nobody accepted before the code expired, so it was destroyed. Show a new code to try again.</Text>
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
  label: { fontSize: 13, fontWeight: "700", marginTop: 8 },
  wide: { alignSelf: "stretch", maxWidth: 340, width: "100%" },
  emoji: { fontSize: 42, marginHorizontal: 6 },
  symbolRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 18, paddingHorizontal: 10, minWidth: 260 },
  glow: { position: "absolute", width: 150, height: 150, borderRadius: 75, left: "50%", marginLeft: -75 },
  tick: { position: "absolute", width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", left: "50%", marginLeft: -32 },
  tickText: { color: "#fff", fontSize: 34, fontWeight: "700" },
  input: { alignSelf: "stretch", borderWidth: 1, borderRadius: 12, padding: 12, fontSize: 14 },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 24, padding: 28 },
  frame: { width: 240, height: 240, borderWidth: 3, borderRadius: 22 },
  overlayText: { color: "#fff", fontSize: 15, textAlign: "center", textShadowColor: "#000", textShadowRadius: 6 },
});
