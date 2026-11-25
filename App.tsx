import { StatusBar } from "expo-status-bar";
import * as ScreenCapture from "expo-screen-capture";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { EngineProvider, useEngine } from "./src/lib/engine";
import { Chat } from "./src/screens/Chat";
import { Home } from "./src/screens/Home";
import { InviteScreen, ScanScreen, VerifyScreen, sharedInvites, type PairOutcome } from "./src/screens/Pairing";
import { extractInviteCode } from "./src/core/invite";
import { aliasFor } from "./src/core/identity";
import { AlertOverlay } from "./src/ui/AlertOverlay";
import { Toast } from "./src/ui/kit";
import { Settings } from "./src/screens/Settings";
import { loadSoundPrefs, playSound } from "./src/lib/sounds";
import { loadPrefs } from "./src/lib/prefs";
import { ThemeModeContext, isDark, useTheme, type Theme, type ThemeMode } from "./src/ui/theme";
import { loadSetting, saveSetting } from "./src/lib/storage";

type Route =
  | { name: "home" }
  | { name: "invite" }
  | { name: "scan" }
  | { name: "verify"; role: "host" | "guest"; safety: string[]; invitePub?: string; expiresAt: number; outcome: PairOutcome; contactId?: string; remote?: boolean }
  | { name: "chat"; id: string }
  | { name: "settings" };

function Screens({ theme }: { theme: Theme }) {
  const { engine, now, notices, clearNotices } = useEngine();
  const [alertFor, setAlertFor] = useState<{ contactId: string; msgId: string } | null>(null);
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { loadSoundPrefs(); loadPrefs(); }, []);

  // pairing events move the screens along; each event has its own optional sound
  useEffect(() => {
    let handled = false;
    for (const n of notices) {
      if (n.type === "message") playSound("message");
      if (n.type === "paired") playSound("paired");
      if (n.type === "pair-expired" || n.type === "invite-expired") playSound("expired");
      if (n.type === "alert") playSound(n.level === "sos" ? "sos" : "help");
      if (n.type === "pair-request" && route.name === "invite") {
        setRoute({ name: "verify", role: "host", safety: n.safety, invitePub: n.invitePub, expiresAt: n.expiresAt, outcome: "pending", remote: sharedInvites.has(n.invitePub) }); handled = true;
      }
      if (n.type === "paired") {
        // let the symbols leave on a high note, then open the chat
        setRoute((r) => (r.name === "verify" ? { ...r, outcome: "paired", contactId: n.contactId } : { name: "chat", id: n.contactId }));
        handled = true;
      }
      if (n.type === "pair-expired") {
        setRoute((r) => (r.name === "verify" && r.outcome === "pending" ? { ...r, outcome: "expired" } : r));
        handled = true;
      }
      if (n.type === "alert") { setAlertFor({ contactId: n.contactId, msgId: n.msgId }); handled = true; }
      if (n.type === "rejected") { setRoute({ name: "home" }); setToast("The other phone rejected the pairing."); handled = true; }
      if (n.type === "invite-expired" && route.name === "invite") { setRoute({ name: "home" }); setToast("Your invite code expired. Show a new one."); handled = true; }
    }
    if (handled || (notices.length && route.name !== "chat")) clearNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notices]);

  // Invite links (velosolabs.com/ashnote/i#ashnote:1:… or ashnote://pair/…) open straight into pairing.
  useEffect(() => {
    const open = async (url?: string | null) => {
      const code = url ? extractInviteCode(url.includes("#") ? url.slice(url.indexOf("#") + 1) : url) : null;
      if (!code) return;
      const r = await engine.scan(code);
      if (r.ok) setRoute({ name: "verify", role: "guest", safety: r.safety, expiresAt: r.expiresAt, outcome: "pending", remote: true });
      else setToast(r.reason);
    };
    Linking.getInitialURL().then(open).catch(() => {});
    const sub = Linking.addEventListener("url", (e) => { open(e.url); });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const home = () => setRoute({ name: "home" });
  return (
    <View style={styles.fill}>
      {route.name === "home" && (
        <Home theme={theme} onInvite={() => setRoute({ name: "invite" })} onScan={() => setRoute({ name: "scan" })}
          onOpen={(id) => setRoute({ name: "chat", id })} onToast={setToast} onSettings={() => setRoute({ name: "settings" })} />
      )}
      {route.name === "invite" && <InviteScreen theme={theme} onCancel={home} />}
      {route.name === "scan" && (
        <ScanScreen theme={theme} onCancel={home}
          onScanned={(safety, expiresAt, remote) => setRoute({ name: "verify", role: "guest", safety, expiresAt, outcome: "pending", remote })} />
      )}
      {route.name === "verify" && (
        <VerifyScreen theme={theme} role={route.role} safety={route.safety} invitePub={route.invitePub} expiresAt={route.expiresAt}
          outcome={route.outcome} remote={route.remote} onDone={home}
          onFinished={() => {
            if (route.outcome === "paired" && route.contactId) setRoute({ name: "chat", id: route.contactId });
            else { setRoute({ name: "home" }); setToast("The code expired before the pairing was accepted."); }
          }} />
      )}
      {route.name === "settings" && <Settings theme={theme} onBack={home} />}
      {route.name === "chat" && <Chat theme={theme} contactId={route.id} onBack={home} />}
      {alertFor && (() => {
        const c = engine.state.contacts[alertFor.contactId];
        const m = c?.messages.find((x) => x.id === alertFor.msgId);
        if (!c || !m) return null;
        return (
          <AlertOverlay msg={m} from={aliasFor(c.theirPub)} now={now} onClose={() => setAlertFor(null)}
            onOpenChat={() => { setAlertFor(null); setRoute({ name: "chat", id: c.id }); }} />
        );
      })()}
      {toast && <Toast text={toast} theme={theme} onDone={() => setToast(null)} />}
    </View>
  );
}

export default function App() {
  const [mode, setModeState] = useState<ThemeMode>("system");
  useEffect(() => {
    loadSetting("colorMode").then((m) => { if (m === "light" || m === "dark" || m === "system") setModeState(m); }).catch(() => {});
  }, []);
  const setMode = (m: ThemeMode) => { setModeState(m); saveSetting("colorMode", m).catch(() => {}); };
  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>
      <Root />
    </ThemeModeContext.Provider>
  );
}

function Root() {
  const theme = useTheme();
  useEffect(() => {
    if (Platform.OS === "web") return;
    // Documentation screenshots only: CI's screenshot build (.github/workflows/screenshots.yml) sets this
    // at build time so the emulator can capture the screens. Release builds never set it.
    if (process.env.EXPO_PUBLIC_SCREENSHOT_MODE === "1") return;
    // Screen capture is disabled on both platforms (owner's rule): screenshots and screen recordings
    // come out blank on Android (FLAG_SECURE) and iPhone (iOS 13+). iPhone also blurs the app switcher.
    ScreenCapture.preventScreenCaptureAsync("ashnote").catch(() => {});
    if (Platform.OS === "ios") ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => {});
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.screen }]}>
        <StatusBar style={isDark(theme) ? "light" : "dark"} />
        <EngineProvider fallback={<View style={styles.center}><ActivityIndicator color={theme.accent} /></View>}>
          <Screens theme={theme} />
        </EngineProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
