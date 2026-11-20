// Notification sounds: every one is off by default and switched on separately in Settings.
// They follow the phone's silent switch.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { loadSetting, saveSetting } from "./storage";

export const SOUNDS = [
  { key: "message", label: "Message received", file: require("../../assets/sounds/message.wav") },
  { key: "sent", label: "Message sent", file: require("../../assets/sounds/sent.wav") },
  { key: "dissolve", label: "Message dissolves", file: require("../../assets/sounds/dissolve.wav") },
  { key: "paired", label: "Contact paired", file: require("../../assets/sounds/paired.wav") },
  { key: "expired", label: "Invite code expired", file: require("../../assets/sounds/expired.wav") },
  { key: "sos", label: "SOS received", file: require("../../assets/sounds/sos.wav") },
  { key: "help", label: "Help request received", file: require("../../assets/sounds/help.wav") },
] as const;
export type SoundKey = (typeof SOUNDS)[number]["key"];
export type SoundPrefs = Record<SoundKey, boolean>;

export const DEFAULT_PREFS: SoundPrefs = Object.fromEntries(SOUNDS.map((s) => [s.key, false])) as SoundPrefs;

let prefs: SoundPrefs = { ...DEFAULT_PREFS };
const players = new Map<SoundKey, AudioPlayer>();
let modeSet = false;

export async function loadSoundPrefs(): Promise<SoundPrefs> {
  try {
    const raw = await loadSetting("sounds");
    if (raw) prefs = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  return prefs;
}

export async function setSoundPref(key: SoundKey, on: boolean): Promise<SoundPrefs> {
  prefs = { ...prefs, [key]: on };
  await saveSetting("sounds", JSON.stringify(prefs)).catch(() => {});
  return prefs;
}

function player(key: SoundKey): AudioPlayer {
  let p = players.get(key);
  if (!p) {
    p = createAudioPlayer(SOUNDS.find((s) => s.key === key)!.file);
    players.set(key, p);
  }
  return p;
}

/** Plays the sound for an event if the person switched that sound on (or always, for a preview). */
export function playSound(key: SoundKey, preview = false) {
  if (!preview && !prefs[key]) return;
  try {
    if (!modeSet) { setAudioModeAsync({ playsInSilentMode: false }).catch(() => {}); modeSet = true; }
    const p = player(key);
    p.seekTo(0);
    p.play();
  } catch {}
}
