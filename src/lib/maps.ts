import { Linking, Platform } from "react-native";
import type { Location } from "../core/engine";

/** Opens the location in the phone's own maps app. */
export function openInMaps(loc: Location) {
  const q = `${loc.lat},${loc.lon}`;
  const url = Platform.OS === "ios" ? `maps:0,0?q=${q}` : Platform.OS === "android" ? `geo:${q}?q=${q}` : `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=17/${q}`;
  Linking.openURL(url).catch(() => Linking.openURL(`https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=17/${q}`));
}

export function describeLocation(loc: Location | null, now: number): string {
  if (!loc) return "Location unavailable";
  const mins = Math.max(0, Math.round((now - loc.at) / 60000));
  const age = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  return `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}${loc.acc != null ? ` · within ${Math.round(loc.acc)} m` : ""} · ${age}`;
}
