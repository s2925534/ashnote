// App lock rules (VLABS-459, the mobile app lock standard): the PIN is kept only as a salted,
// slow hash, and wrong tries add growing waits. Pure functions so they can be tested; the
// secure storage and the lock screen live in src/lib/lock.ts and src/screens/Lock.tsx.
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { gcm } from "@noble/ciphers/aes.js";

export const PIN_MIN = 4;
export const PIN_MAX = 8;
// 10,000 rounds: well under a second on a phone (React Native's Hermes engine runs this pure-JS PBKDF2
// without a JIT, so 150,000 rounds took over 15 s and looked stuck, found in testing on 2026-11-26).
// A 4-digit PIN's protection is the secure storage and the waits after wrong tries, not the rounds.
export const PIN_ITERATIONS = 10_000;
export const PIN_DEFAULT_LENGTH = 4;
// The mobile app lock standard (owner's rule, 2026-11-26): after 5 wrong tries,
// waits of 30 s, 1 min, 5 min, then 15 min for every further wrong try.
export const FREE_TRIES = 5;
export const WAITS_MS = [30_000, 60_000, 300_000] as const;
export const MAX_WAIT_MS = 900_000;
export const RELOCK_AFTER_MS = 60_000; // back from the background after a minute: ask again

// v1 (0.5.0 to 0.5.3): `hash` is the PBKDF2 output itself, and the database key sat in secure storage on its own.
// v2 (VLABS-464): the PBKDF2 output is a master secret that never leaves memory. `hash` is a check value
// derived from it (HKDF "check"), and `wrapped` is the database key sealed with AES-256-GCM under a second
// key derived from it (HKDF "wrap"), so only the right PIN releases the database key.
export type PinRecord = {
  v: 1 | 2; salt: string; hash: string; iterations: number; fails: number; waitUntil: number; len?: number;
  wrapped?: string; // v2: hex of the 12-byte nonce followed by the AES-GCM ciphertext and tag
};

export function validPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

async function master(pin: string, saltHex: string, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8ToBytes(pin), hexToBytes(saltHex), { c: iterations, dkLen: 32 });
}
const sub = (m: Uint8Array, info: string) => hkdf(sha256, m, undefined, utf8ToBytes("ashnote pin " + info), 32);

/** Seals the database key (hex) under the wrapping key; `nonce` is 12 random bytes. */
export function wrapKey(m: Uint8Array, keyHex: string, nonce: Uint8Array): string {
  return bytesToHex(nonce) + bytesToHex(gcm(sub(m, "wrap"), nonce).encrypt(hexToBytes(keyHex)));
}
/** Opens a sealed database key, or null if it was tampered with or the master secret is wrong. */
export function unwrapKey(m: Uint8Array, wrapped: string): string | null {
  try {
    const raw = hexToBytes(wrapped);
    return bytesToHex(gcm(sub(m, "wrap"), raw.slice(0, 12)).decrypt(raw.slice(12)));
  } catch { return null; }
}

/**
 * A new PIN record. With `dbKey` (hex) and a 12-byte `nonce`, it is a v2 record that also seals the
 * database key; without them it is a v1 record (kept only for the tests of older records).
 */
export async function makeRecord(pin: string, salt: Uint8Array, iterations = PIN_ITERATIONS, dbKey?: string, nonce?: Uint8Array): Promise<PinRecord> {
  if (!validPin(pin)) throw new Error("A PIN is 4 to 8 digits.");
  const saltHex = bytesToHex(salt);
  const m = await master(pin, saltHex, iterations);
  const base = { salt: saltHex, iterations, fails: 0, waitUntil: 0, len: pin.length };
  if (dbKey && nonce) return { v: 2, ...base, hash: bytesToHex(sub(m, "check")), wrapped: wrapKey(m, dbKey, nonce) };
  return { v: 1, ...base, hash: bytesToHex(m) };
}

/** How long to wait after this many wrong tries in a row (0 while tries are still free). */
export function waitAfter(fails: number): number {
  if (fails < FREE_TRIES) return 0;
  return WAITS_MS[fails - FREE_TRIES] ?? MAX_WAIT_MS;
}

export type TryResult =
  | { ok: true; record: PinRecord; dbKey?: string } // dbKey: the database key, when the record seals one
  | { ok: false; record: PinRecord; waitMs: number; triesLeft: number };

/**
 * Checks a PIN. While a wait is running nothing is checked (so the wait can't be raced).
 * Returns the updated record to store either way.
 */
export async function tryPin(record: PinRecord, pin: string, now: number): Promise<TryResult> {
  if (record.waitUntil > now) {
    return { ok: false, record, waitMs: record.waitUntil - now, triesLeft: 0 };
  }
  const m = await master(pin, record.salt, record.iterations);
  const hash = bytesToHex(record.v === 2 ? sub(m, "check") : m);
  if (equal(hash, record.hash)) {
    const dbKey = record.v === 2 && record.wrapped ? unwrapKey(m, record.wrapped) ?? undefined : undefined;
    return { ok: true, record: { ...record, fails: 0, waitUntil: 0 }, dbKey };
  }
  const fails = record.fails + 1;
  const wait = waitAfter(fails);
  const next = { ...record, fails, waitUntil: wait ? now + wait : 0 };
  return { ok: false, record: next, waitMs: wait, triesLeft: Math.max(0, FREE_TRIES - fails) };
}

/** Constant-time comparison of two hex strings of the same length. */
function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function describeWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.ceil(s / 60);
  return `${m} min`;
}

// Lock security events (the app lock standard: every lock reset is recorded on the phone).
export type LockEventKind = "pin-set" | "pin-changed" | "phone-owner-reset" | "app-reset" | "wait-started" | "key-sealed";
export type LockEvent = { at: number; kind: LockEventKind };
export const MAX_LOCK_EVENTS = 50;
export const LOCK_EVENT_LABELS: Record<LockEventKind, string> = {
  "pin-set": "PIN chosen",
  "pin-changed": "PIN changed",
  "phone-owner-reset": "Forgot PIN: phone owner confirmed",
  "app-reset": "Ashnote reset",
  "wait-started": "Wrong PINs: wait started",
  "key-sealed": "Data key moved behind the lock",
};

/** Adds an event, newest first, keeping at most MAX_LOCK_EVENTS. */
export function addLockEvent(list: LockEvent[], ev: LockEvent): LockEvent[] {
  return [ev, ...list].slice(0, MAX_LOCK_EVENTS);
}
