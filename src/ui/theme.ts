import { createContext, useContext } from "react";
import { useColorScheme } from "react-native";

const light = {
  bg: "#eef1f6",
  screen: "#f7f8fb",
  panel: "#ffffff",
  ink: "#141824",
  muted: "#5b6375",
  line: "#d6dbe5",
  accent: "#2b5cff",
  accentInk: "#ffffff",
  amber: "#c76f00",
  danger: "#cf3434",
  theirs: "#e3e7ef",
  theirsInk: "#141824",
  backdrop: "rgba(20,24,36,0.45)",
  sheetA: "#ffffff",
  sheetB: "#eef2ff",
};
const dark: typeof light = {
  bg: "#0d1017",
  screen: "#0f131b",
  panel: "#151a24",
  ink: "#e8ecf4",
  muted: "#94a0b6",
  line: "#273041",
  accent: "#7395ff",
  accentInk: "#0a0e18",
  amber: "#f2a43a",
  danger: "#ff6b6b",
  theirs: "#222a38",
  theirsInk: "#e8ecf4",
  backdrop: "rgba(0,0,0,0.6)",
  sheetA: "#1a2030",
  sheetB: "#141a2a",
};

export type Theme = typeof light;
export type ThemeMode = "system" | "light" | "dark";
export const NEXT_MODE: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };

/** The colour mode switch (owner's rule): System follows the phone, Light and Dark are remembered. */
export const ThemeModeContext = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>({ mode: "system", setMode: () => {} });
export const useThemeMode = () => useContext(ThemeModeContext);

export function useTheme(): Theme {
  const system = useColorScheme();
  const { mode } = useThemeMode();
  const resolved = mode === "system" ? system : mode;
  return resolved === "dark" ? dark : light;
}
export const isDark = (t: Theme) => t === dark;

export const font = {
  display: { fontWeight: "700" as const, letterSpacing: -0.3 },
  mono: { fontFamily: "monospace" },
};
