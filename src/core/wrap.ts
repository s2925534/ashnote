// Gift wrapping (NIP-59 style) so relays never learn who sent a message.
//
// rumor (unsigned, by the sender's per-contact key) -> seal (signed by the sender,
// NIP-44 encrypted to the recipient) -> wrap (signed by a random throwaway key,
// NIP-44 encrypted to the recipient, tagged only with the recipient key and an expiry).
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import * as nip44 from "nostr-tools/nip44";
import {
  finalizeEvent,
  generateSecretKey,
  getEventHash,
  getPublicKey,
  verifyEvent,
  type NostrEvent,
} from "nostr-tools/pure";

export const WRAP_KIND = 1059;
export const SEAL_KIND = 13;
export const RUMOR_KIND = 14;
export const MAX_CONTENT = 65536;

const nowSec = (now: number) => Math.floor(now / 1000);

export function wrap(senderPrivHex: string, recipientPub: string, content: string, now: number, expiresAt: number): NostrEvent {
  const senderPriv = hexToBytes(senderPrivHex);
  const rumorBase = { kind: RUMOR_KIND, tags: [], content, created_at: nowSec(now), pubkey: getPublicKey(senderPriv) };
  const rumor = { ...rumorBase, id: getEventHash(rumorBase) };
  const seal = finalizeEvent(
    {
      kind: SEAL_KIND,
      tags: [],
      content: nip44.v2.encrypt(JSON.stringify(rumor), nip44.v2.utils.getConversationKey(senderPriv, recipientPub)),
      created_at: nowSec(now),
    },
    senderPriv,
  );
  const throwaway = generateSecretKey();
  return finalizeEvent(
    {
      kind: WRAP_KIND,
      tags: [["p", recipientPub], ["expiration", String(nowSec(expiresAt))]],
      content: nip44.v2.encrypt(JSON.stringify(seal), nip44.v2.utils.getConversationKey(throwaway, recipientPub)),
      created_at: nowSec(now),
    },
    throwaway,
  );
}

export type Opened = { sender: string; content: string; createdAt: number };

/** Opens a wrap addressed to us. Returns null for anything malformed, forged or not for us. */
export function unwrap(event: NostrEvent, recipientPrivHex: string): Opened | null {
  try {
    if (event.kind !== WRAP_KIND || event.content.length > MAX_CONTENT || !verifyEvent(event)) return null;
    const priv = hexToBytes(recipientPrivHex);
    const seal = JSON.parse(nip44.v2.decrypt(event.content, nip44.v2.utils.getConversationKey(priv, event.pubkey))) as NostrEvent;
    if (seal.kind !== SEAL_KIND || !verifyEvent(seal)) return null;
    const rumor = JSON.parse(nip44.v2.decrypt(seal.content, nip44.v2.utils.getConversationKey(priv, seal.pubkey)));
    if (rumor.pubkey !== seal.pubkey || rumor.kind !== RUMOR_KIND || typeof rumor.content !== "string") return null;
    return { sender: seal.pubkey, content: rumor.content, createdAt: rumor.created_at };
  } catch {
    return null;
  }
}

export function newKeyPair(): { priv: string; pub: string } {
  const sk = generateSecretKey();
  return { priv: bytesToHex(sk), pub: getPublicKey(sk) };
}
