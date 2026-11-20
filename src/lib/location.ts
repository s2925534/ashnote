// Location for SOS and Help alerts: asked for only when an alert is sent, never tracked.
import * as Location from "expo-location";
import type { Location as Loc } from "../core/engine";

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/** Whether location is already allowed, so SOS can send it without asking anything. */
export async function locationStatus(): Promise<"granted" | "denied" | "undetermined"> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    return p.status === "granted" ? "granted" : p.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "denied";
  }
}

export async function allowLocation(): Promise<boolean> {
  try {
    return (await Location.requestForegroundPermissionsAsync()).status === "granted";
  } catch {
    return false;
  }
}

/**
 * Best location within about 6 seconds: a fresh fix, else the last known one, else null.
 * The phone asks for permission only the first time a feature needs it ("while using the app"
 * only); after that, SOS reads the location without any prompt.
 */
export async function currentLocation(): Promise<Loc | null> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== "granted" && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") return null;
    const fresh = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 6000);
    const pos = fresh ?? (await Location.getLastKnownPositionAsync());
    if (!pos) return null;
    return { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy ?? null, at: pos.timestamp };
  } catch {
    return null;
  }
}
