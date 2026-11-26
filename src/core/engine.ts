// The Ashnote engine: pairing, messages, read receipts, timers and deletes.
// Pure TypeScript with no React Native imports, so it runs (and is tested) under Node.
import { safetyCode } from "./identity";
import { createInvite, decodeInvite, encodeInvite, type Invite, INVITE_LIFETIMES_MS, INVITE_LIFETIME_MS } from "./invite";
import { initRatchet, ratchetDecrypt, ratchetEncrypt, upgrade, type RatchetState } from "./ratchet";
import { newKeyPair, unwrap, wrap } from "./wrap";
import type { NostrEvent } from "nostr-tools/pure";

/** Most contacts one phone can have (VLABS-427): keeps relay subscriptions and an SOS to everyone fast. */
export const MAX_CONTACTS = 50;
export const CONTACTS_FULL = `You have ${MAX_CONTACTS} contacts, the most Ashnote allows. Remove one to add someone new.`;
export const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];
export const TTL_CHOICES = [0, 30_000, 300_000, 3_600_000, 86_400_000] as const; // 0 = Off
export const DEFAULT_TTL = 300_000;
export const MAX_UNREAD_MS = 7 * 86_400_000;
export const RELAY_EXPIRY_MS = 7 * 86_400_000;
export const PAIR_TIMEOUT_MS = 15 * 60_000;
export const MAX_TEXT = 2000;
// base64 characters per relay event. Each piece is encrypted three times (ratchet, seal, gift wrap),
// growing about 4/3 per layer plus padding, and NIP-44 and most relays cap a payload near 64 KB.
export const IMAGE_CHUNK = 16_000;
export const MAX_IMAGE_B64 = 640_000; // about 470 KB of JPEG (40 pieces at most)
export const PARTIAL_TTL_MS = 60 * 60_000; // an image that never fully arrives is dropped after an hour

export type Location = { lat: number; lon: number; acc: number | null; at: number };
export type Alert = { level: "sos" | "help"; loc: Location | null; shared?: boolean };

export type Msg = {
  id: string;
  alert?: Alert; // SOS or Help: kept until dismissed, never on a timer
  image?: { data: string; w: number; h: number }; // JPEG, base64; lives only in the encrypted store until deleted
  queued?: boolean; // a received photo waiting behind the one on screen (not in the stack yet)
  progress?: number; // sending a photo: 0..1
  side: "mine" | "theirs";
  text: string;
  ttl: number; // sender's setting when sent (0 = Off)
  sentAt: number;
  order: number;
  status: "sending" | "sent" | "read" | "received";
  readAt: number | null;
  eff: number | null; // the timer actually applied once read (0 = kept)
  expiresAt: number | null;
};

export type Contact = {
  id: string; // = myPub
  myPriv: string;
  myPub: string;
  theirPub: string;
  ratchet: RatchetState;
  ttl: number; // my setting for messages I send
  messages: Msg[];
  tombstones: Record<string, number>; // ids deleted before they arrived -> when
  partials?: Record<string, { n: number; parts: (string | null)[]; w: number; h: number; ttl: number; at: number; first: number }>;
  pairedAt: number;
};

// Both sides of a pairing end when the invite code expires: the symbols are only shown until then.
type Outgoing = { invitePub: string; myPriv: string; myPub: string; safety: string[]; createdAt: number; expiresAt: number };
type Request = { invitePub: string; requesterPub: string; safety: string[]; at: number; expiresAt: number };
type Outbox = { event: NostrEvent; until: number };

export type State = {
  v: 1;
  relays: string[];
  invites: Record<string, Invite>;
  outgoing: Record<string, Outgoing>; // by my pending key
  requests: Record<string, Request>; // by invite key
  contacts: Record<string, Contact>;
  outbox: Outbox[];
  seen: string[];
  lastSync: number;
  seq: number;
};

export type Notice =
  | { type: "pair-request"; invitePub: string; safety: string[]; expiresAt: number }
  | { type: "waiting-accept"; safety: string[]; expiresAt: number }
  | { type: "paired"; contactId: string }
  | { type: "rejected" }
  | { type: "ttl-changed"; contactId: string; ttl: number }
  | { type: "invite-expired" }
  | { type: "pair-expired"; safety: string[] }
  | { type: "screenshot"; contactId: string }
  | { type: "alert"; contactId: string; msgId: string; level: "sos" | "help" }
  | { type: "message"; contactId: string };

export interface Transport {
  publish(event: NostrEvent): Promise<boolean>;
  watch(keys: string[], sinceMs: number): void;
  onEvent(cb: (event: NostrEvent) => void): void;
}

export function emptyState(relays = DEFAULT_RELAYS): State {
  return { v: 1, relays, invites: {}, outgoing: {}, requests: {}, contacts: {}, outbox: [], seen: [], lastSync: 0, seq: 0 };
}

const rid = () => {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
};

type Inner =
  | { t: "msg"; id: string; text: string; ttl: number; at: number }
  | { t: "read"; id: string; eff: number }
  | { t: "del"; id: string }
  | { t: "ttl"; ttl: number }
  | { t: "shot" }
  | { t: "img"; id: string; i: number; n: number; d: string; w: number; h: number; ttl: number; at: number }
  | { t: "alert"; id: string; level: "sos" | "help"; loc: Location | null; shared?: boolean; text: string; at: number };

export class Engine {
  state: State;
  private listeners = new Set<() => void>();
  notices: Notice[] = [];

  constructor(
    state: State | null,
    private deps: { transport: Transport; now: () => number; save: (s: State) => void },
  ) {
    this.state = state ?? emptyState();
    deps.transport.onEvent((e) => this.handle(e));
  }

  // ---------- plumbing ----------
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    this.deps.save(this.state);
    this.listeners.forEach((f) => f());
  }
  private notify(n: Notice) {
    this.notices.push(n);
  }
  takeNotices(): Notice[] {
    const n = this.notices;
    this.notices = [];
    return n;
  }
  watchedKeys(): string[] {
    const s = this.state;
    return [
      ...Object.values(s.invites).filter((i) => i.status === "pending" && i.priv).map((i) => i.pub),
      ...Object.keys(s.outgoing),
      ...Object.keys(s.contacts),
    ];
  }
  start() {
    this.rewatch();
    this.flushOutbox();
  }
  private rewatch() {
    this.deps.transport.watch(this.watchedKeys(), Math.max(0, this.state.lastSync - 10 * 60_000));
  }
  private async publish(event: NostrEvent) {
    const ok = await this.deps.transport.publish(event).catch(() => false);
    if (!ok) {
      this.state.outbox.push({ event, until: this.deps.now() + RELAY_EXPIRY_MS });
      this.deps.save(this.state);
    }
    return ok;
  }
  async flushOutbox() {
    const now = this.deps.now();
    const pending = this.state.outbox.filter((o) => o.until > now);
    this.state.outbox = [];
    for (const o of pending) {
      const ok = await this.deps.transport.publish(o.event).catch(() => false);
      if (!ok) this.state.outbox.push(o);
    }
    this.deps.save(this.state);
  }

  // ---------- pairing ----------
  /** True once this phone has MAX_CONTACTS contacts; new pairings are refused until one is removed. */
  isFull(): boolean {
    return Object.keys(this.state.contacts).length >= MAX_CONTACTS;
  }

  createInvite(): { invite: Invite; code: string } {
    if (this.isFull()) throw new Error(CONTACTS_FULL);
    const inv = createInvite(this.state.relays, this.deps.now());
    this.state.invites[inv.pub] = inv;
    this.rewatch();
    this.changed();
    return { invite: inv, code: encodeInvite(inv) };
  }

  /** Sets how long a pending invite lasts (10 min, 1 h or 24 h from when it was made) and returns its new code. */
  setInviteLifetime(pub: string, lifetimeMs: number): string | null {
    const inv = this.state.invites[pub];
    if (!inv || inv.status !== "pending" || !(INVITE_LIFETIMES_MS as readonly number[]).includes(lifetimeMs)) return null;
    const created = inv.createdAt ?? inv.expiresAt - INVITE_LIFETIME_MS;
    inv.expiresAt = created + lifetimeMs;
    this.changed();
    return encodeInvite(inv);
  }

  cancelInvite(pub: string) {
    const inv = this.state.invites[pub];
    if (!inv || inv.status !== "pending") return;
    inv.status = "cancelled";
    inv.priv = null;
    this.rewatch();
    this.changed();
  }

  /** The scanning phone: send a pairing request to the code's one-off key. */
  async scan(code: string): Promise<{ ok: true; safety: string[]; expiresAt: number } | { ok: false; reason: string }> {
    const now = this.deps.now();
    const d = decodeInvite(code, now);
    if (!d.ok) return d;
    if (this.isFull()) return { ok: false, reason: CONTACTS_FULL };
    if (this.state.invites[d.invite.k]) return { ok: false, reason: "That's your own code. Scan it from the other phone." };
    const me = newKeyPair();
    const safety = safetyCode(d.invite.k, me.pub);
    this.state.outgoing[me.pub] = { invitePub: d.invite.k, myPriv: me.priv, myPub: me.pub, safety, createdAt: now, expiresAt: d.invite.e };
    for (const r of d.invite.r) if (!this.state.relays.includes(r)) this.state.relays.push(r);
    this.rewatch();
    this.notify({ type: "waiting-accept", safety, expiresAt: d.invite.e });
    this.changed();
    await this.publish(wrap(me.priv, d.invite.k, JSON.stringify({ t: "pair", s: d.invite.s }), now, d.invite.e));
    return { ok: true, safety, expiresAt: d.invite.e };
  }

  async acceptRequest(invitePub: string) {
    const req = this.state.requests[invitePub];
    if (!req) return;
    delete this.state.requests[invitePub];
    const now = this.deps.now();
    if (this.isFull()) { await this.rejectRequest(invitePub, req); return; }
    if (now >= req.expiresAt) {
      this.notify({ type: "pair-expired", safety: req.safety });
      this.changed();
      return;
    }
    const me = newKeyPair();
    this.state.contacts[me.pub] = this.newContact(me.priv, me.pub, req.requesterPub, now);
    this.rewatch();
    this.notify({ type: "paired", contactId: me.pub });
    this.changed();
    await this.publish(wrap(me.priv, req.requesterPub, JSON.stringify({ t: "accept" }), now, now + PAIR_TIMEOUT_MS));
  }

  async rejectRequest(invitePub: string, pending?: Request) {
    const req = pending ?? this.state.requests[invitePub];
    if (!req) return;
    delete this.state.requests[invitePub];
    this.changed();
    const now = this.deps.now();
    const throwaway = newKeyPair();
    await this.publish(wrap(throwaway.priv, req.requesterPub, JSON.stringify({ t: "reject" }), now, now + PAIR_TIMEOUT_MS));
  }

  private newContact(myPriv: string, myPub: string, theirPub: string, now: number): Contact {
    return { id: myPub, myPriv, myPub, theirPub, ratchet: initRatchet(myPriv, myPub, theirPub), ttl: DEFAULT_TTL,
      messages: [], tombstones: {}, pairedAt: now };
  }

  // ---------- incoming ----------
  handle(event: NostrEvent) {
    if (this.state.seen.includes(event.id)) return;
    const to = event.tags.find((t) => t[0] === "p")?.[1];
    if (!to) return;
    let used = false;
    const inv = this.state.invites[to];
    if (inv) used = this.onInviteEvent(inv, event);
    else if (this.state.outgoing[to]) used = this.onOutgoingEvent(this.state.outgoing[to], event);
    else if (this.state.contacts[to]) used = this.onContactEvent(this.state.contacts[to], event);
    this.state.seen.push(event.id);
    if (this.state.seen.length > 3000) this.state.seen.splice(0, this.state.seen.length - 3000);
    this.state.lastSync = Math.max(this.state.lastSync, event.created_at * 1000);
    if (used) this.changed();
    else this.deps.save(this.state);
  }

  private onInviteEvent(inv: Invite, event: NostrEvent): boolean {
    // Once used, cancelled or expired, the one-off key is gone: the request can't even be read.
    if (inv.status !== "pending" || !inv.priv) return false;
    const opened = unwrap(event, inv.priv);
    if (!opened) return false;
    let body: { t?: string; s?: string };
    try { body = JSON.parse(opened.content); } catch { return false; }
    if (body.t !== "pair" || body.s !== inv.secret || this.deps.now() > inv.expiresAt) return false;
    inv.status = "used";
    inv.priv = null; // delete the one-off key for good
    const safety = safetyCode(inv.pub, opened.sender);
    this.state.requests[inv.pub] = { invitePub: inv.pub, requesterPub: opened.sender, safety, at: this.deps.now(), expiresAt: inv.expiresAt };
    this.rewatch();
    this.notify({ type: "pair-request", invitePub: inv.pub, safety, expiresAt: inv.expiresAt });
    return true;
  }

  private onOutgoingEvent(out: Outgoing, event: NostrEvent): boolean {
    const opened = unwrap(event, out.myPriv);
    if (!opened) return false;
    let body: { t?: string };
    try { body = JSON.parse(opened.content); } catch { return false; }
    if (body.t === "accept") {
      if (this.deps.now() >= out.expiresAt) return false;
      delete this.state.outgoing[out.myPub];
      this.state.contacts[out.myPub] = this.newContact(out.myPriv, out.myPub, opened.sender, this.deps.now());
      this.rewatch();
      this.notify({ type: "paired", contactId: out.myPub });
      return true;
    }
    if (body.t === "reject") {
      delete this.state.outgoing[out.myPub];
      this.rewatch();
      this.notify({ type: "rejected" });
      return true;
    }
    return false;
  }

  private onContactEvent(c: Contact, event: NostrEvent): boolean {
    const opened = unwrap(event, c.myPriv);
    if (!opened || opened.sender !== c.theirPub) return false;
    let inner: Inner;
    try {
      const sealed = JSON.parse(opened.content);
      const r = ratchetDecrypt(upgrade(c.ratchet, c.myPriv, c.myPub, c.theirPub), sealed);
      c.ratchet = r.state;
      inner = JSON.parse(r.plaintext);
    } catch { return false; }
    const now = this.deps.now();
    switch (inner.t) {
      case "msg": {
        if (c.tombstones[inner.id] || c.messages.some((m) => m.id === inner.id)) return true;
        const text = String(inner.text).slice(0, MAX_TEXT);
        c.messages.push({ id: inner.id, side: "theirs", text, ttl: Number(inner.ttl) || 0, sentAt: inner.at, order: ++this.state.seq,
          status: "received", readAt: null, eff: null, expiresAt: null });
        this.notify({ type: "message", contactId: c.id });
        return true;
      }
      case "read": {
        const m = c.messages.find((x) => x.id === inner.id && x.side === "mine");
        if (!m || m.readAt != null) return true;
        m.status = "read";
        m.readAt = now;
        m.eff = Number(inner.eff) || 0;
        m.expiresAt = m.eff ? now + m.eff : null;
        return true;
      }
      case "del": {
        if (c.partials?.[inner.id]) delete c.partials[inner.id];
        const i = c.messages.findIndex((x) => x.id === inner.id);
        if (i >= 0) c.messages.splice(i, 1);
        else c.tombstones[inner.id] = now;
        return true;
      }
      case "ttl": {
        this.notify({ type: "ttl-changed", contactId: c.id, ttl: Number(inner.ttl) || 0 });
        return true;
      }
      case "alert": {
        if (c.tombstones[inner.id] || c.messages.some((m) => m.id === inner.id)) return true;
        const level = inner.level === "sos" ? "sos" : "help";
        const loc = validLocation(inner.loc);
        c.messages.push({ id: inner.id, side: "theirs", text: String(inner.text).slice(0, 300), ttl: 0, sentAt: inner.at,
          order: ++this.state.seq, status: "received", readAt: null, eff: null, expiresAt: null, alert: { level, loc, shared: inner.shared !== false } });
        this.notify({ type: "alert", contactId: c.id, msgId: inner.id, level });
        return true;
      }
      case "img": {
        if (c.tombstones[inner.id] || c.messages.some((m) => m.id === inner.id)) return true;
        const n = Math.floor(Number(inner.n)), i = Math.floor(Number(inner.i));
        if (!(n > 0 && n <= Math.ceil(MAX_IMAGE_B64 / IMAGE_CHUNK) && i >= 0 && i < n) || typeof inner.d !== "string" || inner.d.length > IMAGE_CHUNK) return false;
        c.partials ??= {};
        const part = (c.partials[inner.id] ??= { n, parts: Array(n).fill(null), w: Number(inner.w) || 0, h: Number(inner.h) || 0,
          ttl: Number(inner.ttl) || 0, at: Number(inner.at) || now, first: now });
        if (part.n !== n) return false;
        part.parts[i] = inner.d;
        if (part.parts.some((x) => x == null)) return true;
        delete c.partials[inner.id];
        const showing = c.messages.some((m) => m.image && !m.queued);
        c.messages.push({ id: inner.id, side: "theirs", text: "", ttl: part.ttl, sentAt: part.at, order: showing ? 0 : ++this.state.seq,
          status: "received", readAt: null, eff: null, expiresAt: null, image: { data: part.parts.join(""), w: part.w, h: part.h },
          queued: showing });
        this.notify({ type: "message", contactId: c.id });
        return true;
      }
      case "shot": {
        this.notify({ type: "screenshot", contactId: c.id });
        return true;
      }
    }
    return false;
  }

  // ---------- outgoing ----------
  private async sendInner(c: Contact, inner: Inner) {
    const r = ratchetEncrypt(upgrade(c.ratchet, c.myPriv, c.myPub, c.theirPub), JSON.stringify(inner));
    c.ratchet = r.state;
    const now = this.deps.now();
    const ev = wrap(c.myPriv, c.theirPub, JSON.stringify(r.sealed), now, now + RELAY_EXPIRY_MS);
    this.deps.save(this.state);
    return this.publish(ev);
  }

  /**
   * Sends a text message. With keepCopy false (the "Replying clears the screen" setting), this
   * phone keeps no copy at all: the message exists only on the other phone.
   */
  async send(contactId: string, text: string, opts: { keepCopy?: boolean } = {}): Promise<Msg | null> {
    const c = this.state.contacts[contactId];
    const body = text.trim().slice(0, MAX_TEXT);
    if (!c || !body) return null;
    const now = this.deps.now();
    const m: Msg = { id: rid(), side: "mine", text: body, ttl: c.ttl, sentAt: now, order: ++this.state.seq, status: "sending",
      readAt: null, eff: null, expiresAt: null };
    if (opts.keepCopy !== false) c.messages.push(m);
    this.changed();
    const ok = await this.sendInner(c, { t: "msg", id: m.id, text: body, ttl: c.ttl, at: now });
    if (c.messages.includes(m) && m.status === "sending") m.status = ok ? "sent" : "sending";
    this.changed();
    return m;
  }

  /** Call when a received message is on top of the stack and on screen. */
  async markRead(contactId: string, msgId: string) {
    const c = this.state.contacts[contactId];
    const m = c?.messages.find((x) => x.id === msgId && x.side === "theirs");
    if (!c || !m || m.readAt != null) return;
    const now = this.deps.now();
    const eff = m.alert ? 0 : effectiveTtl(m.ttl, c.ttl);
    m.readAt = now;
    m.eff = eff;
    m.expiresAt = eff ? now + eff : null;
    this.changed();
    await this.sendInner(c, { t: "read", id: m.id, eff });
  }

  /** Double-tap: delete on this phone now and tell the other phone to delete its copy. */
  async deleteNow(contactId: string, msgId: string) {
    const c = this.state.contacts[contactId];
    if (!c) return;
    const i = c.messages.findIndex((x) => x.id === msgId);
    if (i < 0) return;
    c.messages.splice(i, 1);
    this.changed();
    await this.sendInner(c, { t: "del", id: msgId });
  }

  async setTtl(contactId: string, ttl: number) {
    const c = this.state.contacts[contactId];
    if (!c || !(TTL_CHOICES as readonly number[]).includes(ttl) || c.ttl === ttl) return;
    c.ttl = ttl;
    this.changed();
    await this.sendInner(c, { t: "ttl", ttl });
  }

  /**
   * Sends one photo (JPEG, base64) in pieces through the relays. Each piece is its own
   * ratchet message. On this phone the new photo replaces any earlier photo of ours on screen.
   */
  async sendImage(contactId: string, b64: string, w: number, h: number, opts: { keepCopy?: boolean } = {}): Promise<Msg | null> {
    const c = this.state.contacts[contactId];
    if (!c || !b64 || b64.length > MAX_IMAGE_B64) return null;
    const now = this.deps.now();
    c.messages = c.messages.filter((m) => !(m.side === "mine" && m.image)); // one photo of ours on screen
    const keep = opts.keepCopy !== false;
    const m: Msg = { id: rid(), side: "mine", text: "", ttl: c.ttl, sentAt: now, order: ++this.state.seq, status: "sending",
      readAt: null, eff: null, expiresAt: null, image: keep ? { data: b64, w, h } : undefined, progress: 0 };
    if (keep) c.messages.push(m);
    this.changed();
    const n = Math.ceil(b64.length / IMAGE_CHUNK);
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (keep && !c.messages.includes(m)) return m; // deleted while sending: stop
      ok = (await this.sendInner(c, { t: "img", id: m.id, i, n, d: b64.slice(i * IMAGE_CHUNK, (i + 1) * IMAGE_CHUNK), w, h, ttl: c.ttl, at: now })) && ok;
      m.progress = (i + 1) / n;
      this.changed();
    }
    if (c.messages.includes(m) && m.status === "sending") m.status = ok ? "sent" : "sending";
    delete m.progress;
    this.changed();
    return m;
  }

  /** Received photos waiting behind the one on screen. */
  queuedImages(contactId: string): Msg[] {
    const c = this.state.contacts[contactId];
    return c ? c.messages.filter((m) => m.queued).sort((a, b) => a.sentAt - b.sentAt) : [];
  }

  /** "Show next photo": the photo on screen is deleted for both phones and the next one comes up. */
  async showNextImage(contactId: string) {
    const c = this.state.contacts[contactId];
    if (!c || !this.queuedImages(contactId).length) return;
    const current = c.messages.filter((m) => m.image && !m.queued && m.side === "theirs");
    for (const m of current) await this.deleteNow(contactId, m.id);
    this.promoteImage(c);
    this.changed();
  }

  private promoteImage(c: Contact): boolean {
    if (c.messages.some((m) => m.image && !m.queued && m.side === "theirs")) return false;
    const next = c.messages.filter((m) => m.queued).sort((a, b) => a.sentAt - b.sentAt)[0];
    if (!next) return false;
    next.queued = false;
    next.order = ++this.state.seq;
    return true;
  }

  /**
   * SOS (life-threatening) or Help (not life-threatening): goes straight to the given contacts with
   * this phone's location if it could be found. Alerts are kept until someone dismisses them.
   */
  async sendAlert(contactIds: string[], level: "sos" | "help", loc: Location | null, shared = true): Promise<number> {
    const now = this.deps.now();
    const text = level === "sos" ? "SOS: I need help now." : "I need some help. It's not an emergency.";
    let sent = 0;
    for (const id of contactIds) {
      const c = this.state.contacts[id];
      if (!c) continue;
      const m: Msg = { id: rid(), side: "mine", text, ttl: 0, sentAt: now, order: ++this.state.seq, status: "sending",
        readAt: null, eff: null, expiresAt: null, alert: { level, loc, shared } };
      c.messages.push(m);
      this.changed();
      const ok = await this.sendInner(c, { t: "alert", id: m.id, level, loc, shared, text, at: now });
      if (c.messages.includes(m) && m.status === "sending") m.status = ok ? "sent" : "sending";
      sent++;
    }
    this.changed();
    return sent;
  }

  /** Screenshots are blocked; on iPhone the attempt is also reported to the other person. */
  async reportScreenshot(contactId: string) {
    const c = this.state.contacts[contactId];
    if (c) await this.sendInner(c, { t: "shot" });
  }

  removeContact(contactId: string) {
    delete this.state.contacts[contactId];
    this.rewatch();
    this.changed();
  }

  // ---------- time ----------
  /** Deletes expired messages and invites. Call every second and when the app resumes. */
  tick(): boolean {
    const now = this.deps.now();
    let dirty = false;
    for (const inv of Object.values(this.state.invites)) {
      if (inv.status === "pending" && now >= inv.expiresAt) {
        inv.status = "expired";
        inv.priv = null;
        this.notify({ type: "invite-expired" });
        dirty = true;
      }
      if (inv.status !== "pending" && now - inv.expiresAt > 86_400_000) {
        delete this.state.invites[inv.pub];
        dirty = true;
      }
    }
    for (const o of Object.values(this.state.outgoing)) {
      if (now >= (o.expiresAt ?? o.createdAt + PAIR_TIMEOUT_MS)) {
        delete this.state.outgoing[o.myPub];
        this.notify({ type: "pair-expired", safety: o.safety });
        dirty = true;
      }
    }
    for (const r of Object.values(this.state.requests)) {
      if (now >= r.expiresAt) {
        delete this.state.requests[r.invitePub];
        this.notify({ type: "pair-expired", safety: r.safety });
        dirty = true;
      }
    }
    for (const c of Object.values(this.state.contacts)) {
      const before = c.messages.length;
      c.messages = c.messages.filter((m) => {
        if (m.expiresAt != null && now >= m.expiresAt) return false;
        if (m.readAt == null && now - m.sentAt > MAX_UNREAD_MS) return false;
        return true;
      });
      if (c.messages.length !== before) dirty = true;
      for (const [id, p] of Object.entries(c.partials ?? {})) if (now - p.first > PARTIAL_TTL_MS) { delete c.partials![id]; dirty = true; }
      if (this.promoteImage(c)) dirty = true; // the photo on screen went: the next queued one comes up
      for (const [id, at] of Object.entries(c.tombstones)) if (now - at > RELAY_EXPIRY_MS + 86_400_000) { delete c.tombstones[id]; dirty = true; }
    }
    if (dirty) { this.rewatch(); this.changed(); }
    return dirty;
  }
}

function validLocation(l: unknown): Location | null {
  const x = l as Location | null;
  if (!x || typeof x.lat !== "number" || typeof x.lon !== "number") return null;
  if (Math.abs(x.lat) > 90 || Math.abs(x.lon) > 180) return null;
  return { lat: x.lat, lon: x.lon, acc: typeof x.acc === "number" ? x.acc : null, at: Number(x.at) || 0 };
}

/** The shorter of the sender's and the reader's timers wins. 0 means Off (kept). */
export function effectiveTtl(senderTtl: number, readerTtl: number): number {
  if (!senderTtl) return readerTtl;
  if (!readerTtl) return senderTtl;
  return Math.min(senderTtl, readerTtl);
}

/** The stack shown on screen: the newest message is on top. */
export function stackOf(c: Contact): { top: Msg | null; under: number; unreadUnder: number; queuedImages: number } {
  const queuedImages = c.messages.filter((m) => m.queued).length;
  const ms = c.messages.filter((m) => !m.queued).sort((a, b) => a.order - b.order);
  const top = ms[ms.length - 1] ?? null;
  const rest = ms.slice(0, -1);
  return { top, under: rest.length, unreadUnder: rest.filter((m) => m.side === "theirs" && m.readAt == null).length, queuedImages };
}
