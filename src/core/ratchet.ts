// Symmetric hash ratchet per contact and direction.
//
// Both phones derive two chain keys from their shared secret (ECDH of the per-contact
// keys). Every message uses the next message key in the chain, and the chain key moves
// on, so old keys can't be recomputed: a key stolen later cannot open earlier messages
// (forward secrecy). Used keys are discarded. Out-of-order messages are handled by
// keeping a small number of skipped message keys.
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import * as nip44 from "nostr-tools/nip44";

export const MAX_SKIP = 200;

export type RatchetState = {
  sendCK: string;
  sendN: number;
  recvCK: string;
  recvN: number;
  skipped: Record<string, string>; // message number -> message key (hex)
};

export function initRatchet(myPriv: string, myPub: string, theirPub: string): RatchetState {
  const shared = nip44.v2.utils.getConversationKey(hexToBytes(myPriv), theirPub);
  const chain = (from: string, to: string) =>
    bytesToHex(hkdf(sha256, shared, utf8ToBytes("ashnote-ratchet-v1"), utf8ToBytes(`chain:${from}>${to}`), 32));
  return { sendCK: chain(myPub, theirPub), sendN: 0, recvCK: chain(theirPub, myPub), recvN: 0, skipped: {} };
}

function step(ck: string): { mk: Uint8Array; next: string } {
  const k = hexToBytes(ck);
  return { mk: hmac(sha256, k, Uint8Array.of(1)), next: bytesToHex(hmac(sha256, k, Uint8Array.of(2))) };
}

export type Sealed = { n: number; c: string };

export function ratchetEncrypt(st: RatchetState, plaintext: string): { state: RatchetState; sealed: Sealed } {
  const { mk, next } = step(st.sendCK);
  const sealed = { n: st.sendN, c: nip44.v2.encrypt(plaintext, mk) };
  return { state: { ...st, sendCK: next, sendN: st.sendN + 1 }, sealed };
}

export function ratchetDecrypt(st: RatchetState, sealed: Sealed): { state: RatchetState; plaintext: string } {
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
  // keep the skipped-key store bounded
  const keys = Object.keys(skipped).map(Number).sort((a, b) => a - b);
  while (keys.length > MAX_SKIP) delete skipped[String(keys.shift())];
  return { state: { ...st, recvCK: next, recvN: sealed.n + 1, skipped }, plaintext };
}
