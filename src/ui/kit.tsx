// Small shared pieces: buttons, icon buttons, the dialog and the toast.
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Modal, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { LinearGradientLike } from "./gradient";
import { Icon, type IconName } from "./Icon";
import type { Theme } from "./theme";

export function Button({ label, onPress, theme, primary, danger, disabled, style }: {
  label: string; onPress: () => void; theme: Theme; primary?: boolean; danger?: boolean; disabled?: boolean; style?: ViewStyle;
}) {
  const bg = primary ? theme.accent : danger ? theme.danger : theme.panel;
  const fg = primary ? theme.accentInk : danger ? "#fff" : theme.ink;
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, borderColor: primary ? theme.accent : danger ? theme.danger : theme.line,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}>
      <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

/** Small icon button with an accessible name (the platform shows it on long press). */
export function IconButton({ icon, label, onPress, theme, danger, filled }: {
  icon: IconName; label: string; onPress: () => void; theme: Theme; danger?: boolean; filled?: boolean;
}) {
  const color = filled ? theme.accentInk : danger ? theme.danger : theme.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={6}
      style={({ pressed }) => [styles.icon, { borderColor: danger ? theme.danger : filled ? theme.accent : theme.line,
        backgroundColor: filled ? theme.accent : "transparent", opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={icon} color={color} size={19} />
    </Pressable>
  );
}

/** Dialogs stand out: dimmed backdrop, gradient panel, accent edge. */
export function Dialog({ visible, onClose, theme, title, children }: {
  visible: boolean; onClose: () => void; theme: Theme; title: string; children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: theme.backdrop }]} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheetWrap} onPress={() => {}}>
          <LinearGradientLike from={theme.sheetA} to={theme.sheetB} style={[styles.sheet, { borderTopColor: theme.accent }]}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: theme.ink }]}>{title}</Text>
            {children}
          </LinearGradientLike>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Pill choices (radio buttons as rounded, selectable pills). */
export function Pills<T extends string | number>({ options, value, onChange, theme, label }: {
  options: { label: string; value: T }[]; value: T; onChange: (v: T) => void; theme: Theme; label: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.pills}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={String(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.value)}
            style={[styles.pill, { borderColor: on ? theme.accent : theme.line, backgroundColor: on ? theme.accent : "transparent" }]}>
            <Text style={{ color: on ? theme.accentInk : theme.ink, fontSize: 14 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Toast({ text, theme, onDone, tone = "info" }: { text: string; theme: Theme; onDone: () => void; tone?: "info" | "warn" }) {
  const o = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(o, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(o, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(onDone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View accessibilityLiveRegion="polite" pointerEvents="none"
      style={[styles.toast, { opacity: o, backgroundColor: theme.ink, borderLeftColor: tone === "warn" ? theme.danger : theme.accent }]}>
      <Text style={{ color: theme.bg, fontSize: 13 }}>{text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, alignItems: "center", minHeight: 46, justifyContent: "center" },
  btnText: { fontSize: 15, fontWeight: "600" },
  icon: { width: 40, height: 40, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheetWrap: { width: "100%" },
  sheet: { borderTopWidth: 3, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34, gap: 14 },
  sheetTitle: { fontSize: 18, fontWeight: "700" },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: { borderWidth: 1, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  toast: { position: "absolute", top: 8, left: 14, right: 14, borderRadius: 12, padding: 12, borderLeftWidth: 4, zIndex: 20 },
});
