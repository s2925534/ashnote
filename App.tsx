import { StatusBar } from "expo-status-bar";
import * as ScreenCapture from "expo-screen-capture";
import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { EngineProvider, useEngine } from "./src/lib/engine";
import { Chat } from "./src/screens/Chat";
import { Home } from "./src/screens/Home";
import { InviteScreen, ScanScreen, VerifyScreen } from "./src/screens/Pairing";
import { Toast } from "./src/ui/kit";
import { useTheme, type Theme } from "./src/ui/theme";

type Route =
  | { name: "home" }
  | { name: "invite" }
  | { name: "scan" }
  | { name: "verify"; role: "host" | "guest"; safety: string[]; invitePub?: string }
  | { name: "chat"; id: string };

function Screens({ theme }: { theme: Theme }) {
  const { notices, clearNotices } = useEngine();
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [toast, setToast] = useState<string | null>(null);

  // pairing events move the screens along
  useEffect(() => {
    let handled = false;
    for (const n of notices) {
      if (n.type === "pair-request" && route.name === "invite") { setRoute({ name: "verify", role: "host", safety: n.safety, invitePub: n.invitePub }); handled = true; }
      if (n.type === "paired") { setRoute({ name: "chat", id: n.contactId }); handled = true; }
      if (n.type === "rejected") { setRoute({ name: "home" }); setToast("The other phone rejected the pairing."); handled = true; }
      if (n.type === "invite-expired" && route.name === "invite") { setRoute({ name: "home" }); setToast("Your invite code expired. Show a new one."); handled = true; }
    }
    if (handled || (notices.length && route.name !== "chat")) clearNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notices]);

  const home = () => setRoute({ name: "home" });
  return (
    <View style={styles.fill}>
      {route.name === "home" && (
        <Home theme={theme} onInvite={() => setRoute({ name: "invite" })} onScan={() => setRoute({ name: "scan" })}
          onOpen={(id) => setRoute({ name: "chat", id })} />
      )}
      {route.name === "invite" && <InviteScreen theme={theme} onCancel={home} />}
      {route.name === "scan" && (
        <ScanScreen theme={theme} onCancel={home} onScanned={(safety) => setRoute({ name: "verify", role: "guest", safety })} />
      )}
      {route.name === "verify" && (
        <VerifyScreen theme={theme} role={route.role} safety={route.safety} invitePub={route.invitePub} onDone={home} />
      )}
      {route.name === "chat" && <Chat theme={theme} contactId={route.id} onBack={home} />}
      {toast && <Toast text={toast} theme={theme} onDone={() => setToast(null)} />}
    </View>
  );
}

export default function App() {
  const theme = useTheme();
  useEffect(() => {
    if (Platform.OS === "web") return;
    // Android: block screenshots and screen recording. iOS: hide content in the app switcher.
    ScreenCapture.preventScreenCaptureAsync("ashnote").catch(() => {});
    if (Platform.OS === "ios") ScreenCapture.enableAppSwitcherProtectionAsync(0.9).catch(() => {});
  }, []);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.fill, { backgroundColor: theme.screen }]}>
        <StatusBar style="auto" />
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
