// The app lock screen (VLABS-459): choose a PIN on first run, enter it when Ashnote opens.
// Forgot PIN: the phone's own owner check (fingerprint, face or passcode) lets you choose a new
// PIN; otherwise Reset Ashnote deletes everything on this phone. Nothing goes to a server.
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { PIN_DEFAULT_LENGTH, PIN_MAX, PIN_MIN, describeWait, validPin } from "../core/pinlock";
import {
  biometricsOn, checkPin, confirmPhoneOwner, deviceLockAvailable, loadPin, resetApp, setPin, unlockWithBiometrics,
} from "../lib/lock";
import { Mark } from "../ui/Mark";
import { Button, Dialog } from "../ui/kit";
import type { Theme } from "../ui/theme";

type Stage = "unlock" | "set" | "confirm";

export function LockScreen({ theme, initial, onUnlocked }: { theme: Theme; initial: "unlock" | "set"; onUnlocked: () => void }) {
  const [stage, setStage] = useState<Stage>(initial);
  const [entry, setEntry] = useState("");
  const [first, setFirst] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [canOwner, setCanOwner] = useState(false);
  const [bio, setBio] = useState(false);
  const [viaOwner, setViaOwner] = useState(false);
  const [longer, setLonger] = useState(false);       // choosing a PIN longer than 4 digits
  const [savedLen, setSavedLen] = useState<number | undefined>(undefined); // the stored PIN's length, to check it as soon as it's typed

  useEffect(() => {
    deviceLockAvailable().then(setCanOwner);
    if (initial === "unlock") {
      biometricsOn().then((on) => {
        setBio(on);
        if (on) unlockWithBiometrics().then((ok) => ok && onUnlocked()).catch(() => {});
      });
      // show a running wait straight away
      loadPin().then((r) => {
        setSavedLen(r?.len);
        if (r && r.waitUntil > Date.now()) setMsg(`Too many wrong tries. Wait ${describeWait(r.waitUntil - Date.now())}.`);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = stage === "unlock" ? "Enter your PIN" : stage === "set" ? "Choose a PIN" : "Enter the PIN again";
  const hint = stage === "unlock" ? "Ashnote is locked." : stage === "confirm" ? "Type the same PIN to make sure." :
    longer ? `${PIN_MIN + 2} to ${PIN_MAX} digits, then tap ✓. Only this phone knows it.`
      : `${PIN_DEFAULT_LENGTH} digits. Only this phone knows it.`;
  // how many digits fill the PIN: then it moves on by itself (otherwise ✓ is needed)
  const target = stage === "set" ? (longer ? 0 : PIN_DEFAULT_LENGTH) : stage === "confirm" ? first.length : (savedLen ?? 0);
  const maxLen = stage === "set" && !longer ? PIN_DEFAULT_LENGTH : stage === "confirm" ? first.length : PIN_MAX;

  const submit = async (value: string = entry) => {
    if (busy) return;
    if (!validPin(value) || (stage === "set" && longer && value.length < PIN_MIN + 2)) {
      setMsg(stage === "set" && longer ? `Use ${PIN_MIN + 2} to ${PIN_MAX} digits.` : `Use at least ${PIN_MIN} digits.`); return;
    }
    if (stage === "set") { setFirst(value); setEntry(""); setMsg(""); setStage("confirm"); return; }
    if (stage === "confirm") {
      if (value !== first) { setEntry(""); setFirst(""); setStage("set"); setMsg("The PINs didn't match. Choose one again."); return; }
      setBusy(true); setMsg("");
      try {
        await setPin(value, viaOwner ? "phone-owner-reset" : undefined);
        onUnlocked();
      } catch {
        setEntry(""); setFirst(""); setStage("set"); setMsg("Couldn't save the PIN. Please choose it again.");
      } finally { setBusy(false); }
      return;
    }
    setBusy(true); setMsg("");
    let r: Awaited<ReturnType<typeof checkPin>> = null;
    try { r = await checkPin(value); } catch { setMsg("Couldn't check the PIN. Please try again."); setBusy(false); setEntry(""); return; }
    setBusy(false);
    setEntry("");
    if (!r || r.ok) { onUnlocked(); return; }
    setMsg(r.waitMs ? `Wrong PIN. Wait ${describeWait(r.waitMs)} before trying again.`
      : `Wrong PIN. ${r.triesLeft} more ${r.triesLeft === 1 ? "try" : "tries"} before a wait.`);
  };

  const press = (k: string) => {
    if (busy) return;
    if (k === "del") { setEntry((e) => e.slice(0, -1)); return; }
    if (k === "ok") { void submit(); return; }
    if (entry.length >= maxLen) return;
    const next = entry + k;
    setEntry(next);
    if (target && next.length === target) void submit(next); // filled: move on without ✓
  };

  const ownerCheck = async () => {
    setForgot(false);
    if (await confirmPhoneOwner()) { setViaOwner(true); setEntry(""); setFirst(""); setMsg("Phone confirmed. Choose a new PIN."); setStage("set"); }
    else setMsg("The phone check didn't go through.");
  };
  const reset = async () => {
    setConfirmReset(false); setForgot(false);
    await resetApp();
    setEntry(""); setFirst(""); setMsg("Ashnote was reset. Choose a PIN to start again."); setStage("set");
  };

  return (
    <View style={[styles.fill, { backgroundColor: theme.screen }]} accessibilityViewIsModal>
      <Mark size={56} theme={theme} />
      <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>{title}</Text>
      <Text style={[styles.hint, { color: theme.muted }]}>{hint}</Text>
      <View style={styles.dots} accessibilityLabel={`${entry.length} digits entered`}>
        {Array.from({ length: Math.max(target || PIN_MIN, entry.length) }, (_, i) => (
          <View key={i} style={[styles.dot, { borderColor: theme.muted }, i < entry.length && { backgroundColor: theme.accent, borderColor: theme.accent }]} />
        ))}
      </View>
      {busy ? (
        <View style={styles.busy} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.accent} />
          <Text style={{ color: theme.muted, fontSize: 13 }}>{stage === "unlock" ? "Checking…" : "Saving…"}</Text>
        </View>
      ) : (
        <Text accessibilityLiveRegion="polite" style={[styles.msg, { color: theme.danger }]}>{msg}</Text>
      )}
      <View style={styles.pad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"].map((k) => (
          <Pressable key={k} onPress={() => press(k)} accessibilityRole="button"
            accessibilityLabel={k === "del" ? "Delete" : k === "ok" ? "Done" : k}
            style={({ pressed }) => [styles.key, { borderColor: theme.line, backgroundColor: k === "ok" ? theme.accent : theme.panel, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[styles.keyText, { color: k === "ok" ? theme.accentInk : theme.ink }]}>{k === "del" ? "⌫" : k === "ok" ? "✓" : k}</Text>
          </Pressable>
        ))}
      </View>
      {stage === "set" && (
        <View style={styles.links}>
          <Text accessibilityRole="button" onPress={() => { setLonger((l) => !l); setEntry(""); setMsg(""); }} style={[styles.link, { color: theme.accent }]}>
            {longer ? `Use ${PIN_DEFAULT_LENGTH} digits` : "Use a longer PIN"}
          </Text>
        </View>
      )}
      {stage === "unlock" && (
        <View style={styles.links}>
          {bio && <Text accessibilityRole="button" onPress={() => unlockWithBiometrics().then((ok) => ok && onUnlocked())} style={[styles.link, { color: theme.accent }]}>Use fingerprint or face</Text>}
          <Text accessibilityRole="button" onPress={() => setForgot(true)} style={[styles.link, { color: theme.accent }]}>Forgot PIN?</Text>
        </View>
      )}

      <Dialog visible={forgot} onClose={() => setForgot(false)} theme={theme} title="Forgot your PIN?">
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
          {canOwner
            ? "Prove it's your phone with its fingerprint, face or passcode, then choose a new PIN. Nothing goes to a server."
            : "This phone has no screen lock, so it can't confirm its owner. You can reset Ashnote instead."}
        </Text>
        {canOwner && <Button label="Use fingerprint or phone passcode" primary theme={theme} onPress={ownerCheck} />}
        <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>
          Reset Ashnote deletes every contact, group and message on this phone. You would pair with people again.
        </Text>
        <Button label="Reset Ashnote" danger theme={theme} onPress={() => { setForgot(false); setConfirmReset(true); }} />
        <Button label="Cancel" theme={theme} onPress={() => setForgot(false)} />
      </Dialog>
      <Dialog visible={confirmReset} onClose={() => setConfirmReset(false)} theme={theme} title="Reset Ashnote?">
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
          Every contact, group, message and setting on this phone is deleted. This can't be undone.
        </Text>
        <Button label="Reset and delete everything" danger theme={theme} onPress={reset} />
        <Button label="Keep" theme={theme} onPress={() => setConfirmReset(false)} />
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, zIndex: 50 },
  title: { fontSize: 22, fontWeight: "700" },
  hint: { fontSize: 13, textAlign: "center", maxWidth: 300, lineHeight: 19 },
  dots: { flexDirection: "row", gap: 12, minHeight: 16, marginTop: 6 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5 },
  msg: { fontSize: 13, minHeight: 18, textAlign: "center" },
  busy: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 18 },
  pad: { flexDirection: "row", flexWrap: "wrap", width: 252, gap: 12, justifyContent: "center" },
  key: { width: 72, height: 58, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  keyText: { fontSize: 22, fontWeight: "600" },
  links: { flexDirection: "row", gap: 20, marginTop: 8 },
  link: { fontSize: 14, textDecorationLine: "underline", padding: 6 },
});
