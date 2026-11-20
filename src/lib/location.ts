// Location for SOS and Help alerts: asked for only when an alert is sent, never tracked.
import * as Location from "expo-location";
import type { Location as Loc } from "../core/engine";

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Best location within about 6 seconds: a fresh fix, else the last known one, else null. */
export async function currentLocation(): Promise<Loc | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return null;
    const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 6000);
    const pos = fresh ?? (await Location.getLastKnownPositionAsync());
    if (!pos) return null;
    return { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy ?? null, at: pos.timestamp };
  } catch {
    return null;
  }
}
