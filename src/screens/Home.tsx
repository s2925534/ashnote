import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { stackOf, type Contact } from "../core/engine";
import { aliasFor } from "../core/identity";
import { useEngine } from "../lib/engine";
import { AlertButtons } from "../ui/AlertButtons";
import { Avatar } from "../ui/Avatar";
import { Button, ColorModeButton, Dialog, IconButton } from "../ui/kit";
import { Mark } from "../ui/Mark";
import type { Theme } from "../ui/theme";

export function Home({ theme, onInvite, onScan, onOpen, onToast, onSettings }: {
  theme: Theme; onInvite: () => void; onScan: () => void; onOpen: (id: string) => void; onToast: (t: string) => void; onSettings: () => void;
}) {
  const { engine, transport } = useEngine();
  const [confirm, setConfirm] = useState<Contact | null>(null);
  const contacts = Object.values(engine.state.contacts).sort((a, b) => b.pairedAt - a.pairedAt);
  const relays = transport.connected();

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>Ashnote</Text>
        <View style={styles.headRight}>
          <View style={styles.status} accessibilityLabel={`${relays} relays connected`}>
            <View style={[styles.dot, { backgroundColor: relays ? "#2fb36b" : theme.muted }]} />
            <Text style={{ color: theme.muted, fontSize: 12 }}>{relays ? `${relays} relay${relays === 1 ? "" : "s"}` : "Connecting…"}</Text>
          </View>
          <ColorModeButton theme={theme} />
          <IconButton icon="gear" label="Settings" theme={theme} onPress={onSettings} />
        </View>
      </View>

      {contacts.length === 0 ? (
        <View style={styles.empty}>
          <Mark size={72} theme={theme} />
          <Text style={[styles.emptyTitle, { color: theme.ink }]}>Private chat</Text>
          <Text style={[styles.emptyText, { color: theme.muted }]}>
            No name, number or email. Add someone by showing them your code, or scan theirs. Each contact gets a new key,
            and your alias for them is made from it.
          </Text>
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          ListHeaderComponent={
            <View style={[styles.row, styles.head, { borderColor: theme.line }]}>
              <Text style={[styles.th, { color: theme.muted, flex: 1 }]}>CONTACT</Text>
              <Text style={[styles.th, { color: theme.muted }]}>ACTIONS</Text>
            </View>
          }
          renderItem={({ item: c }) => {
            const s = stackOf(c);
            const unread = c.messages.filter((m) => m.side === "theirs" && m.readAt == null).length;
            return (
              <Pressable onPress={() => onOpen(c.id)} accessibilityRole="button" accessibilityLabel={`Open chat with ${aliasFor(c.theirPub)}`}
                style={[styles.row, { borderColor: theme.line }]}>
                <Avatar pubkey={c.theirPub} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={[styles.alias, { color: theme.ink }]}>{aliasFor(c.theirPub)}</Text>
                  <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>
                    {unread ? `${unread} unread · ` : s.top ? "" : "No messages · "}You appear as {aliasFor(c.myPub)}
                  </Text>
                </View>
                <View style={styles.actions}>
                  <IconButton icon="chat" label="Open chat" theme={theme} onPress={() => onOpen(c.id)} />
                  <IconButton icon="trash" label="Remove contact" theme={theme} danger onPress={() => setConfirm(c)} />
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <View style={styles.bottom}>
        {contacts.length > 0 && (
          <AlertButtons theme={theme} contactIds={contacts.map((c) => c.id)} onSent={onToast}
            scope={contacts.length === 1 ? "your contact" : `all ${contacts.length} contacts`} />
        )}
        <Button label="Show invite code" primary theme={theme} onPress={onInvite} />
        <Button label="Scan a code" theme={theme} onPress={onScan} />
      </View>

      <Dialog visible={!!confirm} onClose={() => setConfirm(null)} theme={theme} title="Remove this contact?">
        <Text style={{ color: theme.muted, fontSize: 14 }}>
          {confirm ? `${aliasFor(confirm.theirPub)} and every message with them are deleted from this phone. To chat again you need to pair again.` : ""}
        </Text>
        <Button label="Remove contact" danger theme={theme} onPress={() => { if (confirm) engine.removeContact(confirm.id); setConfirm(null); }} />
        <Button label="Keep" theme={theme} onPress={() => setConfirm(null)} />
      </Dialog>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14 },
  title: { fontSize: 28, fontWeight: "700", letterSpacing: -0.4 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  headRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 },
  emptyTitle: { fontSize: 22, fontWeight: "700" },
  emptyText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  head: { paddingVertical: 8 },
  th: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  alias: { fontSize: 16, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8 },
  bottom: { padding: 16, gap: 10 },
});
