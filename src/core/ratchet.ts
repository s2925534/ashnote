// Message encryption between two paired phones.
//
// v2 (VLABS-437) is a Double Ratchet in the style of Signal's:
//  - a symmetric chain per direction gives every message a new key and moves on, so a key stolen
//    later can't open earlier messages (forward secrecy);
//  - a Diffie-Hellman ratchet: each phone sends its current ratchet public key with every
//    message, and a new key from the other phone mixes a fresh ECDH secret into a root key, giving
//    new chains. Someone who copied a phone's keys loses access after one round trip
//    (post-compromise security).
//
// Roles are fixed so the two phones never start the ratchet at the same moment: the phone with the
// lower contact public key ("a") starts it; "b" waits for a's first ratchet key.
//
// v1 (0.1.x and 0.2.x) was the symmetric chain only. Its two chains live on in `legacy`: they carry
// messages until both phones know the other speaks v2 (a v2 phone marks its v1 messages with
// cap: 2), and they are "b"'s way to send before "a" has started the ratchet. Contacts paired on an
// older version keep working with phones that haven't updated.
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import * as nip44 from "nostr-tools/nip44";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

export const MAX_SKIP = 200;
const CAP = 2;

/** v1 state: one symmetric chain per direction (0.1.x, 0.2.x). */
export type LegacyState = {
  sendCK: string;
  sendN: number;
  recvCK: string;
  recvN: number;
  skipped: Record<string, string>; // message number -> message key (hex)
};

export type RatchetV2 = {
  v: 2;
  role: "a" | "b";
  me: { priv: string; pub: string }; // this phone's key for the contact
  them: string; // their key for this contact
  peerV2: boolean; // the other phone has shown it speaks v2
  rk: string; // root key
  dhs: { priv: string; pub: string } | null; // our current ratchet key pair (null until the ratchet starts)
  dhr: string | null; // their current ratchet public key
  cks: string | null;
  ns: number;
  ckr: string | null;
  nr: number;
  pn: number; // messages sent in our previous sending chain
  skipped: Record<string, string>; // `${ratchetPub}:${n}` -> message key (hex)
  legacy: LegacyState;
};

export type RatchetState = LegacyState | RatchetV2;

/** What travels inside the gift wrap. v1 messages have no dh; v2 phones add cap: 2 to them. */
export type Sealed = { n: number; c: string; cap?: number; v?: 2; dh?: string; pn?: number };

// ---------- primitives ----------
const dh = (priv: string, pub: string) => nip44.v2.utils.getConversationKey(hexToBytes(priv), pub);

function kdfRK(rk: string, dhOut: Uint8Array): { rk: string; ck: string } {
  const out = hkdf(sha256, dhOut, hexToBytes(rk), utf8ToBytes("ashnote-dr-v2"), 64);
  return { rk: bytesToHex(out.slice(0, 32)), ck: bytesToHex(out.slice(32)) };
}

function step(ck: string): { mk: Uint8Array; next: string } {
  const k = hexToBytes(ck);
  return { mk: hmac(sha256, k, Uint8Array.of(1)), next: bytesToHex(hmac(sha256, k, Uint8Array.of(2))) };
}

function newKeyPair(): { priv: string; pub: string } {
  const sk = generateSecretKey();
  return { priv: bytesToHex(sk), pub: getPublicKey(sk) };
}

function boundSkipped(skipped: Record<string, string>, order: string[]) {
  // keep the most recent MAX_SKIP keys (insertion order)
  const keys = Object.keys(skipped);
  if (keys.length <= MAX_SKIP) return;
  for (const k of order.length ? order : keys) {
    if (Object.keys(skipped).length <= MAX_SKIP) break;
    delete skipped[k];
  }
}

// ---------- v1 (legacy) ----------
function legacyInit(myPriv: string, myPub: string, theirPub: string): LegacyState {
  const shared = dh(myPriv, theirPub);
  const chain = (from: string, to: string) =>
    bytesToHex(hkdf(sha256, shared, utf8ToBytes("ashnote-ratchet-v1"), utf8ToBytes(`chain:${from}>${to}`), 32));
  return { sendCK: chain(myPub, theirPub), sendN: 0, recvCK: chain(theirPub, myPub), recvN: 0, skipped: {} };
}

function legacyEncrypt(st: LegacyState, plaintext: string): { state: LegacyState; sealed: Sealed } {
  const { mk, next } = step(st.sendCK);
  return { state: { ...st, sendCK: next, sendN: st.sendN + 1 }, sealed: { n: st.sendN, c: nip44.v2.encrypt(plaintext, mk) } };
}

function legacyDecrypt(st: LegacyState, sealed: Sealed): { state: LegacyState; plaintext: string } {
  const key = String(sealed.n);
  if (st.skipped[key]) {
    const plaintext = nip44.v2.decrypt(sealed.c, hexToBytes(st.skipped[key]));
    const skipped = { ...st.skipped };
    delete skipped[key];
    return { state: { ...st, skipped }, plaintext };
  }
  if (!Number.isInteger(sealed.n) || sealed.n < st.recvN) throw new Error("message key already used");
  if (sealed.n - st.recvN > MAX_SKIP) throw new Error("too many skipped messages");
  let ck = st.recvCK;
  const skipped = { ...st.skipped };
  for (let n = st.recvN; n < sealed.n; n++) {
    const s = step(ck);
    skipped[String(n)] = bytesToHex(s.mk);
    ck = s.next;
  }
  const { mk, next } = step(ck);
  const plaintext = nip44.v2.decrypt(sealed.c, mk); // throws on tampering, state unchanged
  const keys = Object.keys(skipped).map(Number).sort((a, b) => a - b);
  while (keys.length > MAX_SKIP) delete skipped[String(keys.shift())];
  return { state: { ...st, recvCK: next, recvN: sealed.n + 1, skipped }, plaintext };
}

// ---------- v2 ----------
export function initRatchet(myPriv: string, myPub: string, theirPub: string): RatchetV2 {
  return upgrade(legacyInit(myPriv, myPub, theirPub), myPriv, myPub, theirPub);
}

/** Wraps a v1 state (a contact paired on 0.1.x/0.2.x, or a fresh pairing) in a v2 state. */
export function upgrade(st: RatchetState, myPriv: string, myPub: string, theirPub: string): RatchetV2 {
  if ((st as RatchetV2).v === 2) return st as RatchetV2;
  const shared = dh(myPriv, theirPub);
  const rk = bytesToHex(hkdf(sha256, shared, utf8ToBytes("ashnote-dr-v2-root"), utf8ToBytes(""), 32));
  return {
    v: 2, role: myPub < theirPub ? "a" : "b", me: { priv: myPriv, pub: myPub }, them: theirPub, peerV2: false,
    rk, dhs: null, dhr: null, cks: null, ns: 0, ckr: null, nr: 0, pn: 0, skipped: {}, legacy: st as LegacyState,
  };
}

export const isV2 = (st: RatchetState): st is RatchetV2 => (st as RatchetV2).v === 2;

export function ratchetEncrypt(st0: RatchetState, plaintext: string): { state: RatchetState; sealed: Sealed } {
  if (!isV2(st0)) return legacyEncrypt(st0, plaintext); // not reached from the engine, which upgrades first
  let st: RatchetV2 = { ...st0 };
  if (st.peerV2 && st.role === "a" && !st.dhs) {
    // start the ratchet: our first ratchet key against their contact key
    const dhs = newKeyPair();
    const r = kdfRK(st.rk, dh(dhs.priv, st.them));
    st = { ...st, dhs, dhr: st.them, rk: r.rk, cks: r.ck, ns: 0, pn: 0 };
  }
  if (!st.cks || !st.dhs) {
    // v1 chain: the other phone is on an older version, or we're "b" and "a" hasn't started yet
    const r = legacyEncrypt(st.legacy, plaintext);
    return { state: { ...st, legacy: r.state }, sealed: { ...r.sealed, cap: CAP } };
  }
  const { mk, next } = step(st.cks);
  const sealed: Sealed = { v: 2, dh: st.dhs.pub, pn: st.pn, n: st.ns, c: nip44.v2.encrypt(plaintext, mk) };
  return { state: { ...st, cks: next, ns: st.ns + 1 }, sealed };
}

export function ratchetDecrypt(st0: RatchetState, sealed: Sealed): { state: RatchetState; plaintext: string } {
  if (!isV2(st0)) return legacyDecrypt(st0, sealed);
  if (!sealed.dh) {
    const r = legacyDecrypt(st0.legacy, sealed);
    return { state: { ...st0, legacy: r.state, peerV2: st0.peerV2 || sealed.cap === CAP }, plaintext: r.plaintext };
  }
  if (!/^[0-9a-f]{64}$/.test(sealed.dh) || !Number.isInteger(sealed.n) || sealed.n < 0 || !Number.isInteger(sealed.pn ?? 0))
    throw new Error("bad header");
  const skipped = { ...st0.skipped };
  const id = `${sealed.dh}:${sealed.n}`;
  if (skipped[id]) {
    const plaintext = nip44.v2.decrypt(sealed.c, hexToBytes(skipped[id]));
    delete skipped[id];
    return { state: { ...st0, skipped, peerV2: true }, plaintext };
  }
  let st: RatchetV2 = { ...st0, skipped, peerV2: true };
  const added: string[] = [];
  const skipUntil = (until: number) => {
    if (!st.ckr || !st.dhr) return;
    if (until - st.nr > MAX_SKIP) throw new Error("too many skipped messages");
    let ck = st.ckr;
    for (let n = st.nr; n < until; n++) {
      const s = step(ck);
      const k = `${st.dhr}:${n}`;
      skipped[k] = bytesToHex(s.mk);
      added.push(k);
      ck = s.next;
    }
    st = { ...st, ckr: ck, nr: Math.max(st.nr, until) };
  };
  if (sealed.dh !== st.dhr) {
    if (st.role === "b" && !st.dhs) st = { ...st, dhs: { ...st.me } }; // "a" ratchets against our contact key
    if (st.role === "a" && !st.dhs) throw new Error("ratchet not started"); // only "b" can be first to receive a ratchet key
    skipUntil(sealed.pn ?? 0);
    const r1 = kdfRK(st.rk, dh(st.dhs!.priv, sealed.dh));
    const dhs = newKeyPair();
    const r2 = kdfRK(r1.rk, dh(dhs.priv, sealed.dh));
    st = { ...st, pn: st.ns, ns: 0, nr: 0, dhr: sealed.dh, ckr: r1.ck, dhs, rk: r2.rk, cks: r2.ck };
  }
  skipUntil(sealed.n);
  const { mk, next } = step(st.ckr!);
  const plaintext = nip44.v2.decrypt(sealed.c, mk); // throws on tampering; the caller keeps the old state
  boundSkipped(skipped, Object.keys(st0.skipped));
  return { state: { ...st, ckr: next, nr: sealed.n + 1, skipped }, plaintext };
}
