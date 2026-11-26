// App lock (VLABS-459, VLABS-464). The PIN record, the biometrics choice and the lock events live in the
// phone's secure storage (Keystore / Keychain, this device only, never backed up), apart from the
// encrypted database, so the lock can be checked before the database is opened.
//
// The database key is released only by the lock:
// - the PIN: the record seals the key under a key derived from the PIN (src/core/pinlock.ts, v2 records);
// - the phone owner check: a second sealed copy in the phone-owner vault (modules/ashnote-vault), opened
//   by a fingerprint or face, or the phone's own PIN, pattern, password or passcode. This is how
//   "Unlock with fingerprint or face" and "Forgot PIN" keep your chats.
// Without either, nothing can open the database: Reset Ashnote deletes it.
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { getRandomValues } from "expo-crypto";
import { Platform } from "react-native";
import * as vault from "../../modules/ashnote-vault";
import { PIN_ITERATIONS, addLockEvent, makeRecord, tryPin, type LockEvent, type LockEventKind, type PinRecord, type TryResult } from "../core/pinlock";
import { databaseKey, deleteLegacyKey, destroyDatabase, legacyKey, setDatabaseKey } from "./storage";

const PIN_KEY = "ashnote.pin.v1";
const BIO_KEY = "ashnote.lock.bio";
const EVENTS_KEY = "ashnote.lock.events";
const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const random = (n: number) => getRandomValues(new Uint8Array(n));

export async function loadPin(): Promise<PinRecord | null> {
  const raw = await SecureStore.getItemAsync(PIN_KEY, opts);
  try { return raw ? (JSON.parse(raw) as PinRecord) : null; } catch { return null; }
}

/** Seals the database key under this PIN (v2 record) and keeps the vault copy current. */
async function saveSealed(pin: string, dbKey: string): Promise<void> {
  const rec = await makeRecord(pin, random(16), PIN_ITERATIONS, dbKey, random(12));
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(rec), opts);
  await sealInVault(dbKey);
  // the key now lives only behind the lock: the plain copy from 0.5.3 and earlier goes
  if (await legacyKey()) { await deleteLegacyKey(); await recordLockEvent("key-sealed"); }
}

/** Puts a copy of the key in the phone-owner vault when the phone has a screen lock (no prompt needed). */
async function sealInVault(dbKey: string): Promise<void> {
  if (!(await vault.isAvailable())) { await vault.clear(); return; }
  await vault.seal(dbKey).catch(() => {});
}

/**
 * Chooses or changes the PIN. The database key is the one the app is unlocked with; on first run (or after
 * a reset) it is the plain key from 0.5.3 and earlier if there is one, otherwise a new random key.
 */
export async function setPin(pin: string, reason?: LockEventKind): Promise<void> {
  const prev = await loadPin();
  let dbKey = databaseKey();
  if (!dbKey && prev?.v === 2) throw new Error("Unlock Ashnote before changing the PIN."); // never orphan the data
  if (!dbKey) dbKey = (await legacyKey()) ?? hex(random(32));
  await saveSealed(pin, dbKey);
  setDatabaseKey(dbKey);
  await recordLockEvent(reason ?? (prev ? "pin-changed" : "pin-set"));
}

/** The lock's security events on this phone, newest first (never sent anywhere). */
export async function lockEvents(): Promise<LockEvent[]> {
  try { return JSON.parse((await SecureStore.getItemAsync(EVENTS_KEY, opts)) ?? "[]") as LockEvent[]; } catch { return []; }
}
export async function recordLockEvent(kind: LockEventKind): Promise<void> {
  const next = addLockEvent(await lockEvents(), { at: Date.now(), kind });
  await SecureStore.setItemAsync(EVENTS_KEY, JSON.stringify(next), opts).catch(() => {});
}

/**
 * Checks a PIN and saves the updated try count and wait. The right PIN releases the database key: from a
 * v2 record, or (first unlock after updating from 0.5.3 or earlier) the plain key, which is then sealed.
 */
export async function checkPin(pin: string): Promise<TryResult | null> {
  const rec = await loadPin();
  if (!rec) return null;
  const r = await tryPin(rec, pin, Date.now());
  if (!r.ok) {
    await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(r.record), opts);
    if (r.waitMs && r.record.waitUntil !== rec.waitUntil) await recordLockEvent("wait-started");
    return r;
  }
  let dbKey = r.dbKey ?? null;
  if (!dbKey) {
    if (rec.v === 2) throw new Error("The PIN record is damaged."); // right PIN, but the seal didn't open
    dbKey = (await legacyKey()) ?? hex(random(32));
  }
  if (rec.v !== 2 || rec.iterations !== PIN_ITERATIONS || !rec.len) await saveSealed(pin, dbKey);
  else {
    await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(r.record), opts);
    // the vault copy is missing (no screen lock earlier, or the Keystore dropped it): put it back
    if (!(await vault.isAvailable())) await vault.clear();
    else if (!(await vault.hasSecret())) await sealInVault(dbKey);
  }
  setDatabaseKey(dbKey);
  return { ...r, dbKey };
}

export async function biometricsOn(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIO_KEY, opts)) === "1";
}
export async function setBiometrics(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIO_KEY, on ? "1" : "0", opts);
  const k = databaseKey();
  if (on && k && !(await vault.hasSecret())) await sealInVault(k);
}

/** Whether the phone has fingerprints or a face saved (for the optional biometric unlock). */
export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()) && (await vault.isAvailable());
  } catch { return false; }
}

/** Whether the phone has any lock (passcode, pattern or biometrics) that can prove its owner. */
export async function deviceLockAvailable(): Promise<boolean> {
  try { return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE; }
  catch { return false; }
}

/** Whether the phone owner check can open the data here: the vault holds the key (or 0.5.3's plain key is still there). */
export async function ownerCheckCanUnlock(): Promise<boolean> {
  if (!(await deviceLockAvailable())) return false;
  return (await vault.hasSecret()) || !!(await legacyKey());
}

export type OwnerResult = "ok" | "cancelled" | "unavailable";

/**
 * The phone's owner check, which also releases the database key from the vault.
 * Android: the system prompt (Class 3 biometrics, and the phone's PIN, pattern or password unless
 * biometricOnly), then the vault, which only opens just after it. iPhone: reading the vault shows Face ID,
 * Touch ID or the passcode itself.
 */
async function ownerUnlock(reason: string, biometricOnly: boolean): Promise<OwnerResult> {
  const sealed = await vault.hasSecret();
  if (Platform.OS === "android" || !sealed) {
    const a = await LocalAuthentication.authenticateAsync({
      promptMessage: reason, cancelLabel: biometricOnly ? "Use PIN" : undefined,
      disableDeviceFallback: biometricOnly, biometricsSecurityLevel: "strong",
    });
    if (!a.success) return "cancelled";
  }
  if (sealed) {
    const r = await vault.open(reason);
    if (r.ok) { setDatabaseKey(r.secret); return "ok"; }
    return r.error === "cancelled" ? "cancelled" : "unavailable";
  }
  // updated from 0.5.3 and not unlocked since: the key is still the plain copy
  const old = await legacyKey();
  if (old) { setDatabaseKey(old); return "ok"; }
  return "unavailable";
}

/** Biometric unlock in place of the PIN (only when switched on). */
export async function unlockWithBiometrics(): Promise<OwnerResult> {
  return ownerUnlock("Unlock Ashnote", true);
}

/** Forgot PIN: the phone's own owner check, with its PIN, pattern, password or passcode allowed. */
export async function confirmPhoneOwner(): Promise<OwnerResult> {
  return ownerUnlock("Confirm it's your phone to choose a new Ashnote PIN", false);
}

/** Reset Ashnote: the database (every contact, group, message and setting), the PIN and the vault are deleted. */
export async function resetApp(): Promise<void> {
  await destroyDatabase();
  await vault.clear();
  await SecureStore.deleteItemAsync(PIN_KEY, opts);
  await SecureStore.deleteItemAsync(BIO_KEY, opts);
  // the event list survives a reset, so the reset itself stays on record
  await recordLockEvent("app-reset");
}
