// App lock rules (VLABS-459, the mobile app lock standard): the PIN is kept only as a salted,
// slow hash, and wrong tries add growing waits. Pure functions so they can be tested; the
// secure storage and the lock screen live in src/lib/lock.ts and src/screens/Lock.tsx.
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const PIN_ITERATIONS = 150_000;
// The mobile app lock standard (owner's rule, 2026-11-26): after 5 wrong tries,
// waits of 30 s, 1 min, 5 min, then 15 min for every further wrong try.
export const FREE_TRIES = 5;
export const WAITS_MS = [30_000, 60_000, 300_000] as const;
export const MAX_WAIT_MS = 900_000;
export const RELOCK_AFTER_MS = 60_000; // back from the background after a minute: ask again

export type PinRecord = { v: 1; salt: string; hash: string; iterations: number; fails: number; waitUntil: number };

export function validPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

async function derive(pin: string, saltHex: string, iterations: number): Promise<string> {
  return bytesToHex(await pbkdf2Async(sha256, utf8ToBytes(pin), hexToBytes(saltHex), { c: iterations, dkLen: 32 }));
}

export async function makeRecord(pin: string, salt: Uint8Array, iterations = PIN_ITERATIONS): Promise<PinRecord> {
  if (!validPin(pin)) throw new Error("A PIN is 4 to 8 digits.");
  const saltHex = bytesToHex(salt);
  return { v: 1, salt: saltHex, hash: await derive(pin, saltHex, iterations), iterations, fails: 0, waitUntil: 0 };
}

/** How long to wait after this many wrong tries in a row (0 while tries are still free). */
export function waitAfter(fails: number): number {
  if (fails < FREE_TRIES) return 0;
  return WAITS_MS[fails - FREE_TRIES] ?? MAX_WAIT_MS;
}

export type TryResult =
  | { ok: true; record: PinRecord }
  | { ok: false; record: PinRecord; waitMs: number; triesLeft: number };

/**
 * Checks a PIN. While a wait is running nothing is checked (so the wait can't be raced).
 * Returns the updated record to store either way.
 */
export async function tryPin(record: PinRecord, pin: string, now: number): Promise<TryResult> {
  if (record.waitUntil > now) {
    return { ok: false, record, waitMs: record.waitUntil - now, triesLeft: 0 };
  }
  const hash = await derive(pin, record.salt, record.iterations);
  if (equal(hash, record.hash)) return { ok: true, record: { ...record, fails: 0, waitUntil: 0 } };
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
export type LockEventKind = "pin-set" | "pin-changed" | "phone-owner-reset" | "app-reset" | "wait-started";
export type LockEvent = { at: number; kind: LockEventKind };
export const MAX_LOCK_EVENTS = 50;
export const LOCK_EVENT_LABELS: Record<LockEventKind, string> = {
  "pin-set": "PIN chosen",
  "pin-changed": "PIN changed",
  "phone-owner-reset": "Forgot PIN: phone owner confirmed",
  "app-reset": "Ashnote reset",
  "wait-started": "Wrong PINs: wait started",
};

/** Adds an event, newest first, keeping at most MAX_LOCK_EVENTS. */
export function addLockEvent(list: LockEvent[], ev: LockEvent): LockEvent[] {
  return [ev, ...list].slice(0, MAX_LOCK_EVENTS);
}
