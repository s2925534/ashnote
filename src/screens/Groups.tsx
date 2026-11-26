// Group chats (VLABS-427): pick contacts for a new group, and the group chat itself.
// A group chat works like a one-to-one chat: one message at a time, the sender's alias on it,
// double-tap your own message to delete it for everyone.
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { MAX_GROUP_MEMBERS, TTL_CHOICES, type GroupMsg } from "../core/engine";
import { aliasFor } from "../core/identity";
import { useEngine } from "../lib/engine";
import { getReplyClears } from "../lib/prefs";
import { playSound } from "../lib/sounds";
import { Avatar } from "../ui/Avatar";
import { Button, Dialog, IconButton, Pills, Toast } from "../ui/kit";
import { MessageCard, metaLine } from "../ui/MessageCard";
import type { Theme } from "../ui/theme";
import { TTL_LABELS } from "./Chat";
import { groupName } from "./Home";

export function NewGroup({ theme, onCancel, onCreated }: { theme: Theme; onCancel: () => void; onCreated: (groupId: string) => void }) {
  const { engine } = useEngine();
  const contacts = Object.values(engine.state.contacts).sort((a, b) => b.pairedAt - a.pairedAt);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const max = MAX_GROUP_MEMBERS - 1;
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? (p.length < max ? [...p, id] : p) : p.filter((x) => x !== id)));
  const create = async () => {
    setBusy(true);
    const id = await engine.createGroup(picked);
    setBusy(false);
    if (id) onCreated(id);
  };
  return (
    <View style={styles.fill}>
      <View style={[styles.head, { borderColor: theme.line }]}>
        <IconButton icon="back" label="Back to contacts" theme={theme} onPress={onCancel} />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.ink }]}>New group</Text>
      </View>
      <Text style={[styles.banner, { color: theme.muted, borderColor: theme.line }]}>
        Pick up to {max} contacts ({picked.length} picked). Each gets an invite over your private chat with them, and they can read
        each other's messages in the group even if they never paired.
      </Text>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }}>
        <View style={[styles.row, styles.th, { borderColor: theme.line }]}>
          <Text style={[styles.thText, { color: theme.muted, flex: 1 }]}>CONTACT</Text>
          <Text style={[styles.thText, { color: theme.muted }]}>IN GROUP</Text>
        </View>
        {contacts.map((c) => {
          const on = picked.includes(c.id);
          return (
            <View key={c.id} style={[styles.row, { borderColor: theme.line }]}>
              <Avatar pubkey={c.theirPub} size={36} />
              <Text numberOfLines={1} style={[styles.alias, { color: theme.ink, flex: 1 }]}>{aliasFor(c.theirPub)}</Text>
              <Switch value={on} disabled={!on && picked.length >= max} onValueChange={(v) => toggle(c.id, v)}
                accessibilityLabel={`Add ${aliasFor(c.theirPub)} to the group`}
                trackColor={{ true: theme.accent, false: theme.line }} thumbColor="#ffffff" />
            </View>
          );
        })}
      </ScrollView>
      <View style={{ padding: 16, gap: 10 }}>
        <Button label={busy ? "Sending invites…" : "Create group"} primary theme={theme} disabled={!picked.length || busy} onPress={create} />
        <Text style={{ color: theme.muted, fontSize: 12, textAlign: "center" }}>
          Groups are text only. Messages are encrypted to the group's key, which changes whenever someone leaves.
        </Text>
      </View>
    </View>
  );
}

export function GroupChat({ theme, groupId, onBack }: { theme: Theme; groupId: string; onBack: () => void }) {
  const { engine, now } = useEngine();
  const g = engine.state.groups?.[groupId];
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState(false);
  const [leaveSheet, setLeaveSheet] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const toast = (t: string) => setToasts((x) => [...x, { id: Date.now() + Math.random(), text: t }]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const s = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => s.remove();
  }, []);
  useEffect(() => { if (!g) onBack(); }, [g, onBack]);

  const msgs: GroupMsg[] = g ? [...g.messages].sort((a, b) => a.order - b.order) : [];
  const top = msgs[msgs.length - 1] ?? null;
  const under = Math.max(0, msgs.length - 1);
  const unreadUnder = msgs.slice(0, -1).filter((m) => m.side === "theirs" && m.readAt == null).length;

  // reading resumes when the app comes back to the front
  useEffect(() => {
    const s = AppState.addEventListener("change", (st) => {
      if (st === "active" && top && top.side === "theirs" && top.readAt == null) engine.markGroupRead(groupId, top.id);
    });
    return () => s.remove();
  }, [top, groupId, engine]);

  if (!g) return null;
  const mine = g.creator === g.me.pub;
  const reveal = (m: GroupMsg) => {
    if (m.side === "theirs" && m.readAt == null && AppState.currentState === "active") engine.markGroupRead(groupId, m.id);
  };
  const send = () => {
    const t = text.trim();
    if (!t || g.ended) return;
    setText("");
    playSound("sent");
    // "Replying clears the screen": my own copy of someone else's message goes (theirs stay on their phones)
    if (getReplyClears() && top && top.side === "theirs") void engine.deleteGroupNow(groupId, top.id);
    void engine.sendGroup(groupId, t);
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.head, { borderColor: theme.line }]}>
        <IconButton icon="back" label="Back to contacts" theme={theme} onPress={onBack} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.alias, { color: theme.ink }]}>{groupName(g)}</Text>
          <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>{g.members.length} people · You appear as {aliasFor(g.me.pub)}</Text>
        </View>
        <IconButton icon="gear" label="Disappearing messages" theme={theme} onPress={() => setSheet(true)} />
        <IconButton icon="trash" label={mine && !g.ended ? "End group" : "Leave group"} theme={theme} danger onPress={() => setLeaveSheet(true)} />
      </View>
      <Text style={[styles.banner, { color: theme.muted, borderColor: theme.line }]}>
        {g.ended ? "The creator ended this group. You can read what's left, but not send."
          : `${g.ttl ? `Messages delete ${TTL_LABELS[g.ttl]} after they're read` : "Messages you send are kept"} · double-tap to delete`}
      </Text>

      <View style={styles.stage}>
        <Text style={[styles.stackInfo, { color: theme.muted }]}>
          {under ? `${under} underneath${unreadUnder ? ` · ${unreadUnder} unread` : ""}` : " "}
        </Text>
        <View style={{ flex: 1 }}>
          {top ? (
            <MessageCard key={top.id} msg={top} from={top.side === "mine" ? "You" : aliasFor(top.from)} now={now} theme={theme}
              reduceMotion={reduceMotion} enter={top.side === "mine" ? "lift" : top.readAt == null ? "arrive" : "none"}
              onRevealed={() => reveal(top)}
              onDoubleTap={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
                playSound("dissolve");
                void engine.deleteGroupNow(groupId, top.id);
                if (top.side === "theirs") toast("Deleted from your phone. Only the sender can delete it for everyone.");
              }} />
          ) : (
            <View style={styles.empty}>
              <Text style={{ color: theme.muted, textAlign: "center", fontSize: 15, lineHeight: 22 }}>
                {g.members.length < 2 ? "Waiting for the people you invited to join. They join when their phone next connects." :
                  "One message at a time, with the sender's alias on it. When it's gone, the one underneath comes back."}
              </Text>
            </View>
          )}
        </View>
        <Text style={[styles.stackInfo, { color: theme.muted }]}>{top ? metaLine(top, now) : " "}</Text>
      </View>

      {!g.ended && (
        <View style={[styles.composer, { borderColor: theme.line }]}>
          <TextInput value={text} onChangeText={setText} placeholder="Message the group" placeholderTextColor={theme.muted} onSubmitEditing={send}
            returnKeyType="send" maxLength={2000} accessibilityLabel="Message the group"
            style={[styles.input, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.panel }]} />
          <IconButton icon="send" label="Send" theme={theme} filled onPress={send} />
        </View>
      )}

      {toasts.map((t) => (
        <Toast key={t.id} text={t.text} theme={theme} onDone={() => setToasts((x) => x.filter((y) => y.id !== t.id))} />
      ))}

      <Dialog visible={sheet} onClose={() => setSheet(false)} theme={theme} title="Disappearing messages">
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
          Delete the messages you send to this group this long after each person reads them.
        </Text>
        <Pills label="Delete after reading" theme={theme} value={g.ttl}
          options={TTL_CHOICES.map((v) => ({ label: TTL_LABELS[v], value: v as number }))}
          onChange={(v) => engine.setGroupTtl(g.id, v)} />
        <Button label="Done" primary theme={theme} onPress={() => setSheet(false)} />
      </Dialog>

      <Dialog visible={leaveSheet} onClose={() => setLeaveSheet(false)} theme={theme} title={mine && !g.ended ? "End this group?" : "Leave this group?"}>
        <Text style={{ color: theme.muted, fontSize: 14 }}>
          {mine && !g.ended ? "You started this group. Ending it closes it for everyone and deletes it from this phone."
            : "The group and its messages are deleted from this phone. The others get a new group key, so you can't read anything sent after you leave."}
        </Text>
        <Button label={mine && !g.ended ? "End group" : "Leave group"} danger theme={theme}
          onPress={() => { setLeaveSheet(false); void engine.leaveGroup(g.id).then(onBack); }} />
        <Button label="Stay" theme={theme} onPress={() => setLeaveSheet(false)} />
      </Dialog>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: "700" },
  alias: { fontSize: 16, fontWeight: "700" },
  banner: { fontSize: 12, textAlign: "center", paddingVertical: 7, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  th: { paddingVertical: 8 },
  thText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  stage: { flex: 1, paddingHorizontal: 14 },
  stackInfo: { fontSize: 11, textAlign: "center", paddingVertical: 6, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  composer: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
});
