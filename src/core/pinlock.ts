// App lock rules (VLABS-459, the mobile app lock standard): the PIN is kept only as a salted,
// slow hash, and wrong tries add growing waits. Pure functions so they can be tested; the
// secure storage and the lock screen live in src/lib/lock.ts and src/screens/Lock.tsx.
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const PIN_MIN = 4;
export const PIN_MAX = 8;
export const PIN_ITERATIONS = 150_000;
export const FREE_TRIES = 3;           // wrong tries before the first wait
export const FIRST_WAIT_MS = 30_000;   // then 30 s, doubling each time
export const MAX_WAIT_MS = 3_600_000;  // capped at an hour
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
  return Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** (fails - FREE_TRIES));
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
  return m < 60 ? `${m} min` : "1 hour";
}
