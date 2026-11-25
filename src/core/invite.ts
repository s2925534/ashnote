// Single-use invite codes. The QR code holds a one-off public key, a random secret,
// the relays to use and an expiry time: never the inviter's identity.
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

export const INVITE_PREFIX = "ashnote:1:";
export const INVITE_LIFETIME_MS = 10 * 60 * 1000;
/** Shared invites (sent as a link) may last longer, up to a day. */
export const INVITE_LIFETIMES_MS = [10 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000] as const;
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** The page that opens invite links. The code goes after the #, which browsers never send to the server. */
export const INVITE_LINK_BASE = "https://velosolabs.com/ashnote/i#";

export type InvitePayload = { k: string; s: string; r: string[]; e: number };

export type Invite = {
  pub: string; // one-off public key in the code
  priv: string | null; // deleted (null) as soon as the invite is used, cancelled or expired
  secret: string;
  relays: string[];
  expiresAt: number;
  createdAt?: number;
  status: "pending" | "used" | "cancelled" | "expired";
};

const b64url = {
  encode(s: string): string {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(s: string): string {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
    const bin = atob(pad);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  },
};

export function createInvite(relays: string[], now: number, random = generateSecretKey): Invite {
  const priv = random();
  return {
    pub: getPublicKey(priv),
    priv: bytesToHex(priv),
    secret: bytesToHex(random()).slice(0, 32),
    relays,
    expiresAt: now + INVITE_LIFETIME_MS,
    createdAt: now,
    status: "pending",
  };
}

export function encodeInvite(inv: Invite): string {
  const p: InvitePayload = { k: inv.pub, s: inv.secret, r: inv.relays, e: inv.expiresAt };
  return INVITE_PREFIX + b64url.encode(JSON.stringify(p));
}

export type DecodeResult = { ok: true; invite: InvitePayload } | { ok: false; reason: string };

export function decodeInvite(text: string, now: number): DecodeResult {
  if (!text.startsWith(INVITE_PREFIX)) return { ok: false, reason: "That isn't an Ashnote code." };
  let p: InvitePayload;
  try {
    p = JSON.parse(b64url.decode(text.slice(INVITE_PREFIX.length)));
  } catch {
    return { ok: false, reason: "That code is damaged. Ask for a new one." };
  }
  const hex64 = /^[0-9a-f]{64}$/;
  if (!p || !hex64.test(p.k) || !/^[0-9a-f]{32}$/.test(p.s) || !Array.isArray(p.r) || typeof p.e !== "number")
    return { ok: false, reason: "That code is damaged. Ask for a new one." };
  if (!p.r.every((u) => typeof u === "string" && (u.startsWith("wss://") || /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(u))))
    return { ok: false, reason: "That code is damaged. Ask for a new one." };
  if (p.e <= now) return { ok: false, reason: "That code has expired. Ask for a new one." };
  if (p.e > now + MAX_LIFETIME_MS + 5 * 60 * 1000) return { ok: false, reason: "That code is damaged. Ask for a new one." };
  return { ok: true, invite: p };
}

/** Finds an invite code in a pasted text, an invite link or an ashnote:// link. */
export function extractInviteCode(text: string): string | null {
  const t = (text || "").trim();
  let m = t.match(/ashnote:1:[A-Za-z0-9_-]+/);
  if (m) return m[0];
  try {
    m = decodeURIComponent(t).match(/ashnote:1:[A-Za-z0-9_-]+/);
  } catch {
    m = null;
  }
  return m ? m[0] : null;
}

export const inviteLink = (code: string) => INVITE_LINK_BASE + code;

export const hexKey = (hex: string) => hexToBytes(hex);
