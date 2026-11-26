// App lock storage (VLABS-459): the PIN record and the biometrics choice live in the phone's
// secure storage (Keystore / Keychain, this device only, never backed up), apart from the
// encrypted database, so the lock can be checked before the database is opened.
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { getRandomValues } from "expo-crypto";
import { PIN_ITERATIONS, addLockEvent, makeRecord, tryPin, type LockEvent, type LockEventKind, type PinRecord, type TryResult } from "../core/pinlock";
import { eraseAll } from "./storage";

const PIN_KEY = "ashnote.pin.v1";
const BIO_KEY = "ashnote.lock.bio";
const EVENTS_KEY = "ashnote.lock.events";
const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export async function loadPin(): Promise<PinRecord | null> {
  const raw = await SecureStore.getItemAsync(PIN_KEY, opts);
  try { return raw ? (JSON.parse(raw) as PinRecord) : null; } catch { return null; }
}

export async function setPin(pin: string, reason?: LockEventKind): Promise<void> {
  const had = !!(await loadPin());
  const rec = await makeRecord(pin, getRandomValues(new Uint8Array(16)));
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(rec), opts);
  await recordLockEvent(reason ?? (had ? "pin-changed" : "pin-set"));
}

/** The lock's security events on this phone, newest first (never sent anywhere). */
export async function lockEvents(): Promise<LockEvent[]> {
  try { return JSON.parse((await SecureStore.getItemAsync(EVENTS_KEY, opts)) ?? "[]") as LockEvent[]; } catch { return []; }
}
export async function recordLockEvent(kind: LockEventKind): Promise<void> {
  const next = addLockEvent(await lockEvents(), { at: Date.now(), kind });
  await SecureStore.setItemAsync(EVENTS_KEY, JSON.stringify(next), opts).catch(() => {});
}

/** Checks a PIN against the stored record and saves the updated try count and wait. */
export async function checkPin(pin: string): Promise<TryResult | null> {
  const rec = await loadPin();
  if (!rec) return null;
  const r = await tryPin(rec, pin, Date.now());
  let toSave = r.record;
  // a PIN saved with the old, slower setting (or before its length was kept) is re-saved now
  if (r.ok && (rec.iterations !== PIN_ITERATIONS || !rec.len)) toSave = await makeRecord(pin, getRandomValues(new Uint8Array(16)));
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(toSave), opts);
  if (!r.ok && r.waitMs && r.record.waitUntil !== rec.waitUntil) await recordLockEvent("wait-started");
  return r;
}

export async function biometricsOn(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIO_KEY, opts)) === "1";
}
export async function setBiometrics(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIO_KEY, on ? "1" : "0", opts);
}

/** Whether the phone has fingerprints or a face saved (for the optional biometric unlock). */
export async function biometricsAvailable(): Promise<boolean> {
  try { return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()); }
  catch { return false; }
}

/** Whether the phone has any lock (passcode, pattern or biometrics) that can prove its owner. */
export async function deviceLockAvailable(): Promise<boolean> {
  try { return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE; }
  catch { return false; }
}

/** Biometric unlock in place of the PIN (only when switched on). */
export async function unlockWithBiometrics(): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: "Unlock Ashnote", cancelLabel: "Use PIN", disableDeviceFallback: true,
  });
  return r.success;
}

/** Forgot PIN: the phone's own owner check, with its passcode allowed as a fallback. */
export async function confirmPhoneOwner(): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: "Confirm it's your phone to choose a new Ashnote PIN", disableDeviceFallback: false,
  });
  return r.success;
}

/** Reset Ashnote: every contact, group, message and setting on this phone, and the PIN, are deleted. */
export async function resetApp(): Promise<void> {
  await eraseAll();
  await SecureStore.deleteItemAsync(PIN_KEY, opts);
  await SecureStore.deleteItemAsync(BIO_KEY, opts);
  // the event list survives a reset, so the reset itself stays on record
  await recordLockEvent("app-reset");
}
