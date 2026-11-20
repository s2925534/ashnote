// A chat shows one message at a time: the newest fills the space above the message box.
// When it is deleted or its timer ends, it dissolves and the one underneath comes back.
import * as Haptics from "expo-haptics";
import * as ScreenCapture from "expo-screen-capture";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { TTL_CHOICES, stackOf, type Msg } from "../core/engine";
import { aliasFor } from "../core/identity";
import { useEngine } from "../lib/engine";
import { playSound } from "../lib/sounds";
import { pickPhoto } from "../lib/photos";
import { getReplyClears } from "../lib/prefs";
import { AlertButtons } from "../ui/AlertButtons";
import { Avatar } from "../ui/Avatar";
import { Dialog, IconButton, Pills, Toast, Button } from "../ui/kit";
import { MessageCard, metaLine, type Enter, type Leave } from "../ui/MessageCard";
import type { Theme } from "../ui/theme";

export const TTL_LABELS: Record<number, string> = { 0: "Off", 30_000: "30 s", 300_000: "5 min", 3_600_000: "1 h", 86_400_000: "1 day" };

type Shown = { id: string; snapshot: Msg; enter: Enter; key: number };

export function Chat({ theme, contactId, onBack }: { theme: Theme; contactId: string; onBack: () => void }) {
  const { engine, now, notices, clearNotices } = useEngine();
  const c = engine.state.contacts[contactId];
  const [text, setText] = useState("");
  const [sheet, setSheet] = useState(false);
  const [alertSheet, setAlertSheet] = useState(false);
  const [photoSheet, setPhotoSheet] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; text: string; tone?: "info" | "warn" }[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [ghost, setGhost] = useState<{ snapshot: Msg; leave: Leave; key: number } | null>(null);
  const leaveNext = useRef<Leave>("drift");
  const keyRef = useRef(0);
  const firstRender = useRef(true);
  const riseNext = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const s = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => s.remove();
  }, []);

  const toast = (t: string, tone?: "info" | "warn") => setToasts((x) => [...x, { id: Date.now() + Math.random(), text: t, tone }]);

  // notices for this chat
  useEffect(() => {
    if (!notices.length || !c) return;
    for (const n of notices) {
      if (n.type === "ttl-changed" && n.contactId === c.id)
        toast(`${aliasFor(c.theirPub)} set their messages to ${n.ttl ? `delete ${TTL_LABELS[n.ttl]} after reading` : "be kept"}.`);
      if (n.type === "screenshot" && n.contactId === c.id) toast(`${aliasFor(c.theirPub)} tried to take a screenshot. It was blocked.`, "warn");
    }
    clearNotices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notices]);

  // Screenshots come out blank (blocked on both platforms); on iPhone we can also tell the other person someone tried
  useEffect(() => {
    if (Platform.OS !== "ios" || !c) return;
    const sub = ScreenCapture.addScreenshotListener(() => engine.reportScreenshot(c.id));
    return () => sub.remove();
  }, [c, engine]);

  const msgs = c ? c.messages.filter((m) => !m.queued).sort((a, b) => a.order - b.order) : []; // queued photos wait off-screen
  const top = msgs[msgs.length - 1] ?? null;
  const topId = top?.id ?? null;

  // decide how the top message appears when it changes
  useEffect(() => {
    if (!c) return;
    const prev = shown;
    const stillThere = prev && c.messages.some((m) => m.id === prev.id);
    if (prev && prev.id === topId) return;
    if (prev && !stillThere) {
      // the top message went: dissolve it, then bring the next one up
      setGhost({ snapshot: prev.snapshot, leave: leaveNext.current, key: ++keyRef.current });
      leaveNext.current = "drift";
      riseNext.current = true;
      setShown(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      playSound("dissolve");
      return;
    }
    if (ghost) return; // wait for the dissolve to finish
    if (!top) { setShown(null); riseNext.current = false; return; }
    let enter: Enter;
    if (firstRender.current) enter = top.side === "theirs" && top.readAt == null ? "arrive" : "none";
    else if (riseNext.current) enter = "rise";
    else enter = top.side === "mine" ? "lift" : "arrive";
    firstRender.current = false;
    riseNext.current = false;
    setShown({ id: top.id, snapshot: top, enter, key: ++keyRef.current });
    if (enter === "arrive") Haptics.selectionAsync().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topId, ghost == null]);

  const reveal = (m: Msg) => {
    if (m.side === "theirs" && m.readAt == null && AppState.currentState === "active") engine.markRead(contactId, m.id);
  };
  // reading resumes when the app comes back to the front
  useEffect(() => {
    const s = AppState.addEventListener("change", (st) => {
      const t = c && stackOf(c).top;
      if (st === "active" && t && t.side === "theirs" && t.readAt == null && shown?.id === t.id) engine.markRead(contactId, t.id);
    });
    return () => s.remove();
  }, [c, shown, contactId, engine]);

  if (!c) return null;
  const s = stackOf(c);
  const current = shown ? c.messages.find((m) => m.id === shown.id) ?? shown.snapshot : null;
  const sendPhoto = async (source: "camera" | "library") => {
    setPhotoSheet(false);
    const r = await pickPhoto(source);
    if (!r) return;
    if ("error" in r) { toast(r.error, "warn"); return; }
    playSound("sent");
    const keep = !clearOnReply();
    engine.sendImage(contactId, r.b64, r.w, r.h, { keepCopy: keep });
    if (!keep) toast("Photo sent. No copy is kept on your phone.");
  };
  /** "Replying clears the screen": the message being answered is deleted for both phones. */
  const clearOnReply = (): boolean => {
    if (!getReplyClears()) return false;
    const t = c && stackOf(c).top;
    if (t && t.side === "theirs" && !t.alert) { leaveNext.current = "drift"; engine.deleteNow(contactId, t.id); }
    return true;
  };
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    playSound("sent");
    const keep = !clearOnReply();
    engine.send(contactId, t, { keepCopy: keep });
    if (!keep) toast("Sent. No copy is kept on your phone.");
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.head, { borderColor: theme.line }]}>
        <IconButton icon="back" label="Back to contacts" theme={theme} onPress={onBack} />
        <Avatar pubkey={c.theirPub} size={38} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={[styles.alias, { color: theme.ink }]}>{aliasFor(c.theirPub)}</Text>
          <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>You appear as {aliasFor(c.myPub)}</Text>
        </View>
        <IconButton icon="alert" label="SOS or Help" theme={theme} danger onPress={() => setAlertSheet(true)} />
        <IconButton icon="gear" label="Disappearing messages" theme={theme} onPress={() => setSheet(true)} />
      </View>
      <Text style={[styles.banner, { color: theme.muted, borderColor: theme.line }]}>
        {c.ttl ? `Messages delete ${TTL_LABELS[c.ttl]} after they're read` : "Messages you send are kept"} · double-tap to delete now
      </Text>

      <View style={styles.stage}>
        <Text style={[styles.stackInfo, { color: theme.muted }]}>
          {s.under ? `${s.under} underneath${s.unreadUnder ? ` · ${s.unreadUnder} unread` : ""}` : " "}
        </Text>
        <View style={styles.cardArea}>
          {!current && !ghost && (
            <View style={styles.emptyStage}>
              <Text style={{ color: theme.muted, textAlign: "center", fontSize: 15, lineHeight: 22 }}>
                One message at a time. The newest fills this space. When it's gone, the one underneath comes back.
              </Text>
            </View>
          )}
          {current && shown && (
            <MessageCard key={shown.key} msg={current} from={aliasFor(c.theirPub)} now={now} theme={theme} reduceMotion={reduceMotion}
              enter={shown.enter} onRevealed={() => reveal(current)}
              onDoubleTap={() => { leaveNext.current = "burst"; Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); engine.deleteNow(contactId, current.id); }} />
          )}
          {ghost && (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <MessageCard key={ghost.key} msg={ghost.snapshot} from={aliasFor(c.theirPub)} now={now} theme={theme} reduceMotion={reduceMotion}
                enter="none" leave={ghost.leave} onGone={() => setGhost(null)} />
            </View>
          )}
        </View>
        <Text style={[styles.meta, { color: theme.muted }]}>{current ? metaLine(current, now) : " "}</Text>
        {s.queuedImages > 0 && (
          <View style={[styles.queue, { borderColor: theme.line, backgroundColor: theme.panel }]}>
            <Text style={{ color: theme.ink, flex: 1, fontSize: 13 }}>
              {s.queuedImages === 1 ? "1 photo waiting" : `${s.queuedImages} photos waiting`}
              <Text style={{ color: theme.muted }}> · the photo on screen is deleted for both of you</Text>
            </Text>
            <Button label="Show next photo" primary theme={theme} onPress={() => { leaveNext.current = "burst"; engine.showNextImage(contactId); }} />
          </View>
        )}
      </View>

      <View style={[styles.composer, { borderColor: theme.line }]}>
        <IconButton icon="image" label="Send a photo" theme={theme} onPress={() => setPhotoSheet(true)} />
        <TextInput value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={theme.muted} onSubmitEditing={send}
          returnKeyType="send" maxLength={2000} accessibilityLabel="Message"
          style={[styles.input, { color: theme.ink, borderColor: theme.line, backgroundColor: theme.panel }]} />
        <IconButton icon="send" label="Send" theme={theme} filled onPress={send} />
      </View>

      {toasts.map((t) => (
        <Toast key={t.id} text={t.text} tone={t.tone} theme={theme} onDone={() => setToasts((x) => x.filter((y) => y.id !== t.id))} />
      ))}

      <Dialog visible={photoSheet} onClose={() => setPhotoSheet(false)} theme={theme} title="Send a photo">
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
          One photo at a time. It's deleted just like a message ({c.ttl ? `${TTL_LABELS[c.ttl]} after it's seen` : "when someone deletes it"}), and hidden photo data such as location is removed before sending.
        </Text>
        <Button label="Take a photo" primary theme={theme} onPress={() => sendPhoto("camera")} />
        <Button label="Choose a photo" theme={theme} onPress={() => sendPhoto("library")} />
        <Button label="Cancel" theme={theme} onPress={() => setPhotoSheet(false)} />
      </Dialog>

      <Dialog visible={alertSheet} onClose={() => setAlertSheet(false)} theme={theme} title={`Alert ${aliasFor(c.theirPub)}`}>
        <AlertButtons theme={theme} contactIds={[c.id]} scope={aliasFor(c.theirPub)}
          onSent={(t) => { setAlertSheet(false); toast(t); }} />
      </Dialog>

      <Dialog visible={sheet} onClose={() => setSheet(false)} theme={theme} title="Disappearing messages">
        <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>
          Delete messages this long after they're read. Applies to messages you send from now on. If the other phone's setting is
          shorter, theirs wins.
        </Text>
        <Pills label="Delete after reading" theme={theme} value={c.ttl}
          options={TTL_CHOICES.map((v) => ({ label: TTL_LABELS[v], value: v as number }))}
          onChange={(v) => engine.setTtl(c.id, v)} />
        <Button label="Done" primary theme={theme} onPress={() => setSheet(false)} />
      </Dialog>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  alias: { fontSize: 16, fontWeight: "700" },
  banner: { fontSize: 12, textAlign: "center", paddingVertical: 7, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  stage: { flex: 1, paddingHorizontal: 14 },
  stackInfo: { fontSize: 11, textAlign: "center", paddingVertical: 6, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  cardArea: { flex: 1 },
  emptyStage: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  meta: { fontSize: 11, textAlign: "center", paddingVertical: 7, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  queue: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 10, marginBottom: 6 },
  composer: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, borderWidth: 1, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15 },
});
