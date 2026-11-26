import { useEffect, useState } from "react";
import Constants from "expo-constants";
import { Linking, Platform, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { DEFAULT_PREFS, SOUNDS, loadSoundPrefs, playSound, setSoundPref, type SoundPrefs } from "../lib/sounds";
import { loadPrefs, setReplyClears } from "../lib/prefs";
import { biometricsAvailable, biometricsOn, lockEvents, setBiometrics } from "../lib/lock";
import { LOCK_EVENT_LABELS, type LockEvent } from "../core/pinlock";
import { LockScreen } from "./Lock";
import { Button, ColorModeButton, IconButton } from "../ui/kit";
import { useThemeMode, type Theme } from "../ui/theme";

export function Settings({ theme, onBack }: { theme: Theme; onBack: () => void }) {
  const [prefs, setPrefs] = useState<SoundPrefs>(DEFAULT_PREFS);
  const { mode } = useThemeMode();
  const [replyClears, setRC] = useState(true);
  const [bioAvail, setBioAvail] = useState(false);
  const [bio, setBio] = useState(false);
  const [changingPin, setChangingPin] = useState(false);
  const [events, setEvents] = useState<LockEvent[]>([]);
  const lockOn = Platform.OS !== "web";
  useEffect(() => {
    loadSoundPrefs().then(setPrefs); loadPrefs().then((p) => setRC(p.replyClears));
    if (lockOn) { biometricsAvailable().then(setBioAvail); biometricsOn().then(setBio); lockEvents().then(setEvents); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (changingPin) return <LockScreen theme={theme} initial="set" onUnlocked={() => { setChangingPin(false); lockEvents().then(setEvents); }} />;
  return (
    <View style={styles.fill}>
      <View style={[styles.head, { borderColor: theme.line }]}>
        <IconButton icon="back" label="Back" theme={theme} onPress={onBack} />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.h, { color: theme.ink }]}>Appearance</Text>
        <View style={[styles.row, { borderColor: theme.line }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.ink }]}>Colour mode</Text>
            <Text style={[styles.hint, { color: theme.muted }]}>
              {mode === "system" ? "System: follows your phone" : mode === "light" ? "Light" : "Dark"}. Tap to switch System, Light, Dark.
            </Text>
          </View>
          <ColorModeButton theme={theme} />
        </View>

        <Text style={[styles.h, { color: theme.ink }]}>Conversation</Text>
        <View style={[styles.row, { borderColor: theme.line }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: theme.ink }]}>Replying clears the screen</Text>
            <Text style={[styles.hint, { color: theme.muted }]}>
              When you send, the message you were answering is deleted for both of you, and your phone keeps no copy of what you send. On by default.
            </Text>
          </View>
          <Switch value={replyClears} accessibilityLabel="Replying clears the screen"
            trackColor={{ false: theme.line, true: theme.accent }} thumbColor="#ffffff"
            onValueChange={(v) => { setRC(v); setReplyClears(v); }} />
        </View>

        <Text style={[styles.h, { color: theme.ink }]}>Sounds</Text>
        <Text style={[styles.hint, { color: theme.muted }]}>
          All sounds are off unless you switch them on. They follow your phone's silent switch. SOS and Help always vibrate.
        </Text>
        {SOUNDS.map((s) => (
          <View key={s.key} style={[styles.row, { borderColor: theme.line }]}>
            <Text style={[styles.label, { color: theme.ink, flex: 1 }]}>{s.label}</Text>
            <IconButton icon="play" label={`Play the ${s.label.toLowerCase()} sound`} theme={theme} onPress={() => playSound(s.key, true)} />
            <Switch value={prefs[s.key]} accessibilityLabel={`${s.label} sound`}
              trackColor={{ false: theme.line, true: theme.accent }} thumbColor="#ffffff"
              onValueChange={(v) => setSoundPref(s.key, v).then(setPrefs)} />
          </View>
        ))}

        {lockOn && (
          <>
            <Text style={[styles.h, { color: theme.ink }]}>App lock</Text>
            <Text style={[styles.hint, { color: theme.muted }]}>
              Ashnote asks for your PIN when it opens and after a minute in the background. Only this phone knows the PIN.
              If you forget it, your phone's fingerprint, face or passcode lets you choose a new one.
            </Text>
            {bioAvail && (
              <View style={[styles.row, { borderColor: theme.line }]}>
                <Text style={[styles.label, { color: theme.ink, flex: 1 }]}>Unlock with fingerprint or face</Text>
                <Switch value={bio} accessibilityLabel="Unlock with fingerprint or face"
                  onValueChange={(v) => { setBio(v); setBiometrics(v).catch(() => {}); }} />
              </View>
            )}
            <Button label="Change PIN" theme={theme} onPress={() => setChangingPin(true)} />
            {events.length > 0 && (
              <View accessibilityLabel="Recent lock events">
                <View style={[styles.row, { borderColor: theme.line }]}>
                  <Text style={[styles.hint, { color: theme.muted, flex: 1, fontWeight: "700" }]}>LOCK EVENT</Text>
                  <Text style={[styles.hint, { color: theme.muted, fontWeight: "700" }]}>WHEN</Text>
                </View>
                {events.slice(0, 10).map((e) => (
                  <View key={`${e.at}-${e.kind}`} style={[styles.row, { borderColor: theme.line }]}>
                    <Text style={[styles.hint, { color: theme.ink, flex: 1 }]}>{LOCK_EVENT_LABELS[e.kind] ?? e.kind}</Text>
                    <Text style={[styles.hint, { color: theme.muted }]}>{new Date(e.at).toLocaleString()}</Text>
                  </View>
                ))}
                <Text style={[styles.hint, { color: theme.muted }]}>Kept only on this phone, so you can see if someone reset the lock.</Text>
              </View>
            )}
          </>
        )}

        <Text style={[styles.h, { color: theme.ink }]}>Updates</Text>
        <Text style={[styles.hint, { color: theme.muted }]}>
          Version {Constants.expoConfig?.version ?? "?"}. New versions are on velosolabs.com/ashnote/download: install the new file over
          this one and your contacts and settings stay.
          {Platform.OS === "android"
            ? " On Samsung phones, switch off Auto Blocker (Settings › Security and privacy › Auto Blocker) while you install, then switch it back on. Google Play Protect checks the file first."
            : ""}
        </Text>
        <Button label="Get the latest version" theme={theme} onPress={() => Linking.openURL("https://velosolabs.com/ashnote/download")} />

        {process.env.EXPO_PUBLIC_DIST === "apk" && (
          <>
            <Text style={[styles.h, { color: theme.ink }]}>Support Ashnote</Text>
            <Text style={[styles.hint, { color: theme.muted }]}>
              Ashnote is free, with no ads and no tracking. If it's useful to you, you can leave a one-off tip on velosolabs.com.
              It doesn't unlock anything, and nothing about your chats or contacts is sent.
            </Text>
            <Button label="Leave a tip" theme={theme} onPress={() => Linking.openURL("https://velosolabs.com/ashnote/support")} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: "700" },
  body: { padding: 18, gap: 10 },
  h: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6, marginTop: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 15 },
  hint: { fontSize: 12, lineHeight: 17 },
});
