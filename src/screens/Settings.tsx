import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { DEFAULT_PREFS, SOUNDS, loadSoundPrefs, playSound, setSoundPref, type SoundPrefs } from "../lib/sounds";
import { ColorModeButton, IconButton } from "../ui/kit";
import { useThemeMode, type Theme } from "../ui/theme";

export function Settings({ theme, onBack }: { theme: Theme; onBack: () => void }) {
  const [prefs, setPrefs] = useState<SoundPrefs>(DEFAULT_PREFS);
  const { mode } = useThemeMode();
  useEffect(() => { loadSoundPrefs().then(setPrefs); }, []);
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
