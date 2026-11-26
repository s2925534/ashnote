import assert from "node:assert/strict";
import { test } from "node:test";
import type { NostrEvent } from "nostr-tools/pure";
import { Engine, effectiveTtl, stackOf, type Transport } from "../src/core/engine";
import { aliasFor, safetyCode } from "../src/core/identity";
import { decodeInvite, encodeInvite, extractInviteCode, inviteLink } from "../src/core/invite";
import { initRatchet, ratchetDecrypt, ratchetEncrypt, upgrade, type RatchetState, type RatchetV2, type Sealed } from "../src/core/ratchet";
import { newKeyPair, unwrap, wrap } from "../src/core/wrap";

// ---------- an in-memory relay shared by every phone in a test ----------
class FakeRelay {
  events: NostrEvent[] = [];
  phones = new Set<FakeTransport>();
  online = true;
  publish(e: NostrEvent) {
    if (!this.online) return false;
    this.events.push(e);
    for (const p of this.phones) p.deliver(e);
    return true;
  }
}
class FakeTransport implements Transport {
  keys = new Set<string>();
  cb: (e: NostrEvent) => void = () => {};
  connected = true;
  constructor(public relay: FakeRelay) { relay.phones.add(this); }
  async publish(e: NostrEvent) { return this.relay.publish(e); }
  watch(keys: string[]) {
    const fresh = keys.filter((k) => !this.keys.has(k));
    this.keys = new Set(keys);
    // replay stored events for new keys, like a relay answering a new subscription
    if (fresh.length && this.connected) for (const e of this.relay.events) if (fresh.includes(this.p(e))) this.cb(e);
  }
  onEvent(cb: (e: NostrEvent) => void) { this.cb = cb; }
  deliver(e: NostrEvent) { if (this.connected && this.keys.has(this.p(e))) queueMicrotask(() => this.cb(e)); }
  p(e: NostrEvent) { return e.tags.find((t) => t[0] === "p")![1]; }
  /** App closed: nothing arrives. Opening replays what the relay holds. */
  close() { this.connected = false; }
  open() { this.connected = true; const k = [...this.keys]; this.keys = new Set(); this.watch(k); }
}

let clock = 1_800_000_000_000;
const now = () => clock;
const flush = () => new Promise((r) => setTimeout(r, 0));

function phone(relay: FakeRelay) {
  const t = new FakeTransport(relay);
  const e = new Engine(null, { transport: t, now, save: () => {} });
  e.start();
  return { e, t };
}

async function pair(relay = new FakeRelay()) {
  const A = phone(relay), B = phone(relay);
  const { code, invite } = A.e.createInvite();
  const scanned = await B.e.scan(code);
  assert.equal(scanned.ok, true);
  await flush();
  const req = Object.values(A.e.state.requests)[0];
  assert.ok(req, "A got the pairing request");
  assert.deepEqual(req.safety, (scanned as { safety: string[] }).safety, "both phones show the same symbols");
  await A.e.acceptRequest(invite.pub);
  await flush();
  const a = Object.values(A.e.state.contacts)[0], b = Object.values(B.e.state.contacts)[0];
  assert.ok(a && b, "both phones are paired");
  return { relay, A, B, a, b, invite, code };
}

test("aliases come from keys and are stable", () => {
  const { pub } = newKeyPair();
  assert.equal(aliasFor(pub), aliasFor(pub));
  assert.match(aliasFor(pub), /^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
  const x = newKeyPair().pub, y = newKeyPair().pub;
  assert.deepEqual(safetyCode(x, y), safetyCode(y, x));
});

test("pairing: both sides get contacts that know each other's per-contact key", async () => {
  const { a, b } = await pair();
  assert.equal(a.theirPub, b.myPub);
  assert.equal(b.theirPub, a.myPub);
});

test("an invite code works once: the key is deleted and a copy is ignored", async () => {
  const { relay, A, code, invite } = await pair();
  assert.equal(A.e.state.invites[invite.pub].status, "used");
  assert.equal(A.e.state.invites[invite.pub].priv, null);
  const C = phone(relay);
  const r = await C.e.scan(code);
  assert.equal(r.ok, true, "C can send a request...");
  await flush();
  assert.equal(Object.keys(A.e.state.requests).length, 0, "...but A never reads it");
  assert.equal(Object.keys(A.e.state.contacts).length, 1);
});

test("expired and cancelled invites are refused", async () => {
  const relay = new FakeRelay();
  const A = phone(relay), B = phone(relay);
  const { code, invite } = A.e.createInvite();
  clock += 11 * 60_000;
  A.e.tick();
  assert.equal(A.e.state.invites[invite.pub].status, "expired");
  assert.equal((await B.e.scan(code)).ok, false, "the scanner sees it expired");
  const second = A.e.createInvite();
  A.e.cancelInvite(second.invite.pub);
  await B.e.scan(second.code);
  await flush();
  assert.equal(Object.keys(A.e.state.requests).length, 0);
  assert.equal(decodeInvite("hello", clock).ok, false);
});

test("rejecting ends the pairing on both phones", async () => {
  const relay = new FakeRelay();
  const A = phone(relay), B = phone(relay);
  const { code, invite } = A.e.createInvite();
  await B.e.scan(code);
  await flush();
  await A.e.rejectRequest(invite.pub);
  await flush();
  assert.equal(Object.keys(B.e.state.outgoing).length, 0);
  assert.equal(Object.keys(B.e.state.contacts).length, 0);
  assert.ok(B.e.takeNotices().some((n) => n.type === "rejected"));
});

test("messages, read receipts and the shorter timer", async () => {
  const { A, B, a, b } = await pair();
  await B.e.setTtl(b.id, 30_000); // B prefers 30 s
  await A.e.send(a.id, "hello");
  await flush();
  const got = B.e.state.contacts[b.id].messages[0];
  assert.equal(got.text, "hello");
  assert.equal(got.readAt, null, "delivered is not read");
  await B.e.markRead(b.id, got.id);
  await flush();
  assert.equal(got.eff, 30_000, "shorter of A's 5 min and B's 30 s");
  const mine = A.e.state.contacts[a.id].messages[0];
  assert.equal(mine.status, "read");
  assert.equal(mine.eff, 30_000, "the sender's copy uses the same timer");
  clock += 31_000;
  A.e.tick(); B.e.tick();
  assert.equal(A.e.state.contacts[a.id].messages.length, 0);
  assert.equal(B.e.state.contacts[b.id].messages.length, 0);
});

test("double-tap delete removes both copies", async () => {
  const { A, B, a, b } = await pair();
  await A.e.send(a.id, "oops");
  await flush();
  const id = B.e.state.contacts[b.id].messages[0].id;
  await B.e.deleteNow(b.id, id);
  await flush();
  assert.equal(A.e.state.contacts[a.id].messages.length, 0);
  assert.equal(B.e.state.contacts[b.id].messages.length, 0);
});

test("unsend before the other app is opened: never shown", async () => {
  const { A, B, a, b } = await pair();
  B.t.close();
  const m = await A.e.send(a.id, "never mind");
  await A.e.deleteNow(a.id, m!.id);
  B.t.open();
  await flush(); await flush();
  assert.equal(B.e.state.contacts[b.id].messages.length, 0);
});

test("messages wait while the app is closed, timers start only when read", async () => {
  const { A, B, a, b } = await pair();
  B.t.close();
  await A.e.send(a.id, "one");
  await A.e.send(a.id, "two");
  clock += 60 * 60_000;
  B.t.open();
  await flush(); await flush();
  const c = B.e.state.contacts[b.id];
  assert.equal(c.messages.length, 2);
  const s = stackOf(c);
  assert.equal(s.top!.text, "two", "newest on top");
  assert.equal(s.under, 1);
  assert.equal(s.unreadUnder, 1);
  assert.ok(c.messages.every((m) => m.expiresAt == null), "no timer before reading");
});

test("off on one side: the other side's timer applies", () => {
  assert.equal(effectiveTtl(0, 300_000), 300_000);
  assert.equal(effectiveTtl(300_000, 0), 300_000);
  assert.equal(effectiveTtl(0, 0), 0);
});

test("forged or replayed traffic is ignored", async () => {
  const { relay, A, B, a, b } = await pair();
  // someone else writes to A's contact key
  const stranger = newKeyPair();
  relay.publish(wrap(stranger.priv, a.myPub, JSON.stringify({ n: 0, c: "x" }), clock, clock + 1000));
  await flush();
  assert.equal(A.e.state.contacts[a.id].messages.length, 0);
  // replaying a real event does nothing twice
  await B.e.send(b.id, "once");
  await flush();
  const ev = relay.events[relay.events.length - 1];
  relay.publish(ev);
  await flush();
  assert.equal(A.e.state.contacts[a.id].messages.length, 1);
});

test("ratchet: forward secrecy and out-of-order delivery", () => {
  const x = newKeyPair(), y = newKeyPair();
  let sx: RatchetState = initRatchet(x.priv, x.pub, y.pub), sy: RatchetState = initRatchet(y.priv, y.pub, x.pub);
  const sealed: Sealed[] = [];
  for (const t of ["a", "b", "c"]) { const r = ratchetEncrypt(sx, t); sx = r.state; sealed.push(r.sealed); }
  let r = ratchetDecrypt(sy, sealed[2]); sy = r.state; assert.equal(r.plaintext, "c");
  r = ratchetDecrypt(sy, sealed[0]); sy = r.state; assert.equal(r.plaintext, "a");
  assert.throws(() => ratchetDecrypt(sy, sealed[0]), "a used key is gone");
  r = ratchetDecrypt(sy, sealed[1]); assert.equal(r.plaintext, "b");
});

test("wraps hide the sender from relays and can't be opened by others", () => {
  const s = newKeyPair(), rcp = newKeyPair(), other = newKeyPair();
  const ev = wrap(s.priv, rcp.pub, "hi", clock, clock + 60_000);
  assert.notEqual(ev.pubkey, s.pub);
  assert.deepEqual(ev.tags.map((t) => t[0]), ["p", "expiration"]);
  assert.equal(unwrap(ev, rcp.priv)!.sender, s.pub);
  assert.equal(unwrap(ev, other.priv), null);
});

test("a screenshot on one phone is reported to the other", async () => {
  const { A, B, a, b } = await pair();
  A.e.takeNotices();
  await B.e.reportScreenshot(b.id);
  await flush();
  assert.ok(A.e.takeNotices().some((n) => n.type === "screenshot" && n.contactId === a.id));
});

test("pairing ends on both phones when the code expires before anyone accepts", async () => {
  const relay = new FakeRelay();
  const A = phone(relay), B = phone(relay);
  const { code, invite } = A.e.createInvite();
  await B.e.scan(code);
  await flush();
  assert.equal(Object.keys(A.e.state.requests).length, 1);
  A.e.takeNotices(); B.e.takeNotices();
  clock = invite.expiresAt + 1;
  A.e.tick(); B.e.tick();
  assert.equal(Object.keys(A.e.state.requests).length, 0, "host drops the request");
  assert.equal(Object.keys(B.e.state.outgoing).length, 0, "scanner stops waiting");
  assert.ok(A.e.takeNotices().some((n) => n.type === "pair-expired"));
  assert.ok(B.e.takeNotices().some((n) => n.type === "pair-expired"));
  await A.e.acceptRequest(invite.pub); // too late: nothing happens
  await flush();
  assert.equal(Object.keys(A.e.state.contacts).length + Object.keys(B.e.state.contacts).length, 0);
});

test("SOS goes to every chosen contact with the location and is never on a timer", async () => {
  const relay = new FakeRelay();
  const { A, B, a, b } = await pair(relay);
  // a second contact for A
  const C = phone(relay);
  const inv = A.e.createInvite();
  await C.e.scan(inv.code); await flush();
  await A.e.acceptRequest(inv.invite.pub); await flush();
  const c2 = Object.values(A.e.state.contacts).find((x) => x.id !== a.id)!;
  const cc = Object.values(C.e.state.contacts)[0];
  B.e.takeNotices(); C.e.takeNotices();
  const loc = { lat: -27.4698, lon: 153.0251, acc: 12, at: clock };
  assert.equal(await A.e.sendAlert([a.id, c2.id], "sos", loc), 2);
  await flush();
  for (const [P, id] of [[B, b.id], [C, cc.id]] as const) {
    const m = P.e.state.contacts[id].messages.find((x) => x.alert)!;
    assert.equal(m.alert!.level, "sos");
    assert.deepEqual(m.alert!.loc, loc);
    assert.ok(P.e.takeNotices().some((n) => n.type === "alert" && n.level === "sos"));
    await P.e.markRead(id, m.id);
    assert.equal(m.expiresAt, null, "alerts are kept until dismissed");
  }
  clock += 2 * 86_400_000;
  B.e.tick();
  assert.equal(B.e.state.contacts[b.id].messages.filter((x) => x.alert).length, 1);
});

test("Help without a location still arrives", async () => {
  const { A, B, a, b } = await pair();
  await A.e.sendAlert([a.id], "help", null);
  await flush();
  const m = B.e.state.contacts[b.id].messages[0];
  assert.equal(m.alert!.level, "help");
  assert.equal(m.alert!.loc, null);
});

const fakeJpeg = (kb: number, seed = "A") => seed.repeat(Math.round(kb * 1365)); // base64-sized string

test("a photo arrives in pieces, out of order, and is rebuilt exactly", async () => {
  const relay = new FakeRelay();
  const { A, B, a, b } = await pair(relay);
  const img = fakeJpeg(100) + "xyz";
  await A.e.sendImage(a.id, img, 1280, 960);
  await flush();
  const m = B.e.state.contacts[b.id].messages.find((x) => x.image)!;
  assert.equal(m.image!.data, img);
  assert.equal(m.image!.w, 1280);
  assert.ok(relay.events.length > 4, "sent as several relay events");
});

test("one photo on screen: a second waits in the queue; Show next deletes the first on both phones", async () => {
  const { A, B, a, b } = await pair();
  await A.e.send(a.id, "a text message stays");
  await A.e.sendImage(a.id, fakeJpeg(20, "B"), 100, 100);
  await A.e.sendImage(a.id, fakeJpeg(20, "C"), 100, 100);
  await flush();
  const c = B.e.state.contacts[b.id];
  const imgs = c.messages.filter((m) => m.image);
  assert.equal(imgs.length, 2);
  assert.equal(imgs.filter((m) => m.queued).length, 1, "the second photo waits");
  assert.equal(stackOf(c).queuedImages, 1);
  const first = imgs.find((m) => !m.queued)!;
  await B.e.showNextImage(b.id);
  await flush();
  assert.ok(!c.messages.some((m) => m.id === first.id), "the first photo is gone");
  assert.equal(c.messages.filter((m) => m.image && !m.queued).length, 1, "the next one is on screen");
  assert.ok(c.messages.some((m) => m.text === "a text message stays"), "text messages are untouched");
  assert.ok(!A.e.state.contacts[a.id].messages.some((m) => m.id === first.id), "deleted on the sender's phone too");
});

test("when the photo on screen times out, the next queued photo appears by itself", async () => {
  const { A, B, a, b } = await pair();
  await A.e.sendImage(a.id, fakeJpeg(10, "D"), 10, 10);
  await A.e.sendImage(a.id, fakeJpeg(10, "E"), 10, 10);
  await flush();
  const c = B.e.state.contacts[b.id];
  const shown = c.messages.find((m) => m.image && !m.queued)!;
  await B.e.markRead(b.id, shown.id);
  clock += 5 * 60_000 + 1000;
  B.e.tick();
  assert.ok(!c.messages.some((m) => m.id === shown.id), "the first photo is deleted");
  const next = c.messages.find((m) => m.image)!;
  assert.equal(next.queued, false, "the next photo comes up");
  assert.equal(next.expiresAt, null, "its timer starts only once it is read");
});

test("deleting a photo while it is still arriving leaves nothing behind", async () => {
  const relay = new FakeRelay();
  const { A, B, a, b } = await pair(relay);
  B.t.close();
  const m = await A.e.sendImage(a.id, fakeJpeg(80, "F"), 10, 10);
  await A.e.deleteNow(a.id, m!.id);
  B.t.open();
  await flush(); await flush();
  const c = B.e.state.contacts[b.id];
  assert.equal(c.messages.length, 0);
  assert.equal(Object.keys(c.partials ?? {}).length, 0);
});

test("every photo piece stays under the relay size limit", async () => {
  const relay = new FakeRelay();
  const { A, a } = await pair(relay);
  const before = relay.events.length;
  await A.e.sendImage(a.id, fakeJpeg(460, "Z"), 10, 10);
  const sizes = relay.events.slice(before).map((e) => JSON.stringify(e).length);
  assert.ok(sizes.length > 1);
  assert.ok(Math.max(...sizes) < 65_000, `largest event ${Math.max(...sizes)} bytes`);
});

test("replying clears the screen: no copy is kept on the sending phone", async () => {
  const { A, B, a, b } = await pair();
  await A.e.send(a.id, "hello");
  await flush();
  const got = B.e.state.contacts[b.id].messages[0];
  await B.e.markRead(b.id, got.id);
  // B replies with the option on: B's received message is deleted for both, and B keeps no copy of the reply
  await B.e.deleteNow(b.id, got.id);
  await B.e.send(b.id, "hi back", { keepCopy: false });
  await B.e.sendImage(b.id, fakeJpeg(5, "Q"), 10, 10, { keepCopy: false });
  await flush();
  assert.equal(B.e.state.contacts[b.id].messages.length, 0, "nothing left on the replying phone");
  const onA = A.e.state.contacts[a.id].messages;
  assert.ok(!onA.some((m) => m.text === "hello"), "the original is gone from the sender too");
  assert.ok(onA.some((m) => m.text === "hi back"), "the reply arrived");
  assert.ok(onA.some((m) => m.image), "the photo arrived");
});

test("shared invites: a link can last 24 hours, still works once, and pairs after a day's wait", async () => {
  const relay = new FakeRelay();
  const A = phone(relay), B = phone(relay);
  const { invite } = A.e.createInvite();
  assert.equal(A.e.setInviteLifetime(invite.pub, 5 * 60_000), null, "only the offered lifetimes");
  const code = A.e.setInviteLifetime(invite.pub, 24 * 60 * 60_000)!;
  assert.ok(code);
  clock += 23 * 60 * 60_000; // read the email the next morning
  A.e.tick();
  assert.equal(A.e.state.invites[invite.pub].status, "pending");
  const link = inviteLink(code);
  assert.ok(link.startsWith("https://velosolabs.com/ashnote/i#ashnote:1:"));
  assert.equal(extractInviteCode(link), code);
  assert.equal(extractInviteCode("ashnote://pair/" + encodeURIComponent(code)), code);
  assert.equal(extractInviteCode("Add me on Ashnote (works once): " + link), code);
  assert.equal((await B.e.scan(extractInviteCode(link)!)).ok, true);
  await flush();
  await A.e.acceptRequest(invite.pub);
  await flush();
  assert.equal(Object.keys(B.e.state.contacts).length, 1, "paired through the link");
  const C = phone(relay);
  assert.equal((await C.e.scan(code)).ok, true, "a copy can still send a request...");
  await flush();
  assert.equal(Object.keys(A.e.state.requests).length, 0, "...but the used invite refuses it");
});

test("an invite claiming to last more than a day is refused", () => {
  const forged = encodeInvite({ pub: "a".repeat(64), priv: null, secret: "b".repeat(32), relays: ["wss://relay.example"],
    expiresAt: clock + 3 * 24 * 60 * 60_000, status: "pending" });
  assert.equal(decodeInvite(forged, clock).ok, false);
});

// ---------- Double Ratchet (VLABS-437) ----------
function drPair() {
  const x = newKeyPair(), y = newKeyPair();
  const [lo, hi] = x.pub < y.pub ? [x, y] : [y, x];
  return { a: initRatchet(lo.priv, lo.pub, hi.pub) as RatchetState, b: initRatchet(hi.priv, hi.pub, lo.pub) as RatchetState };
}
const enc = (s: RatchetState, t: string) => ratchetEncrypt(s, t);
const dec = (s: RatchetState, m: Sealed) => ratchetDecrypt(s, m);

test("double ratchet: starts after both sides show v2, then every reply brings a new ratchet key", () => {
  let { a, b } = drPair();
  let r = enc(b, "b first, before a has started"); b = r.state;
  assert.equal(r.sealed.dh, undefined); assert.equal(r.sealed.cap, 2);
  let d = dec(a, r.sealed); a = d.state; assert.equal(d.plaintext, "b first, before a has started");
  r = enc(a, "a starts the ratchet"); a = r.state; assert.ok(r.sealed.dh, "v2 header");
  const k1 = r.sealed.dh;
  d = dec(b, r.sealed); b = d.state; assert.equal(d.plaintext, "a starts the ratchet");
  r = enc(b, "b replies on the ratchet"); b = r.state; assert.ok(r.sealed.dh && r.sealed.dh !== (b as RatchetV2).me.pub);
  d = dec(a, r.sealed); a = d.state;
  r = enc(a, "a again"); a = r.state; assert.notEqual(r.sealed.dh, k1, "a moved to a new ratchet key");
  d = dec(b, r.sealed); b = d.state; assert.equal(d.plaintext, "a again");
});

test("double ratchet: a copied phone state stops working once the phone has replied on a fresh ratchet key", () => {
  let { a, b } = drPair();
  let r = enc(b, "hi"); b = r.state; a = dec(a, r.sealed).state;
  r = enc(a, "hello"); a = r.state; b = dec(b, r.sealed).state;
  const stolen: RatchetState = JSON.parse(JSON.stringify(b)); // attacker copies b's keys
  r = enc(a, "still readable by the copy"); a = r.state;
  assert.equal(dec(stolen, r.sealed).plaintext, "still readable by the copy");
  b = dec(b, r.sealed).state;
  // b's next ratchet key was made before the copy, so one more exchange is still exposed...
  r = enc(b, "reply on a key the copy knows"); b = r.state; a = dec(a, r.sealed).state;
  r = enc(a, "a answers"); a = r.state; b = dec(b, r.sealed).state; // b now makes a ratchet key the copy never saw
  r = enc(b, "b replies on a fresh key"); b = r.state; a = dec(a, r.sealed).state;
  r = enc(a, "secret after recovery"); a = r.state;
  assert.equal(dec(b, r.sealed).plaintext, "secret after recovery");
  assert.throws(() => dec(stolen, r.sealed), "the copied keys no longer open new messages");
  r = enc(b, "and the other way"); b = r.state;
  assert.equal(dec(a, r.sealed).plaintext, "and the other way");
  assert.throws(() => dec(stolen, r.sealed));
});

test("double ratchet: out-of-order and late messages across ratchet steps", () => {
  let { a, b } = drPair();
  let r = enc(b, "x"); b = r.state; a = dec(a, r.sealed).state;
  const fromA: Sealed[] = [];
  for (const t of ["a1", "a2", "a3"]) { r = enc(a, t); a = r.state; fromA.push(r.sealed); }
  let d = dec(b, fromA[2]); b = d.state; assert.equal(d.plaintext, "a3");
  r = enc(b, "b2"); b = r.state; a = dec(a, r.sealed).state;     // ratchet step
  r = enc(a, "a4"); a = r.state; d = dec(b, r.sealed); b = d.state; assert.equal(d.plaintext, "a4");
  d = dec(b, fromA[0]); b = d.state; assert.equal(d.plaintext, "a1", "late message from the previous chain");
  d = dec(b, fromA[1]); b = d.state; assert.equal(d.plaintext, "a2");
  assert.throws(() => dec(b, fromA[1]), "each key works once");
});

test("double ratchet: a phone still on 0.2 keeps talking to a 0.3 phone (v1 chains)", () => {
  const x = newKeyPair(), y = newKeyPair();
  let old: RatchetState = initRatchet(x.priv, x.pub, y.pub).legacy; // an older app only has the v1 chains
  let nu: RatchetState = initRatchet(y.priv, y.pub, x.pub);
  for (let i = 0; i < 3; i++) {
    let r = enc(old, "from old " + i); old = r.state;
    let d = dec(nu, r.sealed); nu = d.state; assert.equal(d.plaintext, "from old " + i);
    r = enc(nu, "from new " + i); nu = r.state;
    assert.equal(r.sealed.dh, undefined, "no v2 header until the other phone shows v2");
    d = dec(old, r.sealed); old = d.state; assert.equal(d.plaintext, "from new " + i);
  }
  assert.equal((nu as RatchetV2).peerV2, false);
});

test("double ratchet: a contact stored by 0.2 upgrades in place and keeps its message counters", () => {
  const x = newKeyPair(), y = newKeyPair();
  let sx: RatchetState = initRatchet(x.priv, x.pub, y.pub).legacy, sy: RatchetState = initRatchet(y.priv, y.pub, x.pub).legacy;
  for (let i = 0; i < 2; i++) { const r = enc(sx, "old " + i); sx = r.state; sy = dec(sy, r.sealed).state; }
  sx = upgrade(sx, x.priv, x.pub, y.pub); sy = upgrade(sy, y.priv, y.pub, x.pub); // both phones update
  for (let i = 0; i < 4; i++) {
    let r = enc(sx, "x" + i); sx = r.state; let d = dec(sy, r.sealed); sy = d.state; assert.equal(d.plaintext, "x" + i);
    r = enc(sy, "y" + i); sy = r.state; d = dec(sx, r.sealed); sx = d.state; assert.equal(d.plaintext, "y" + i);
  }
  assert.ok((sx as RatchetV2).dhs && (sy as RatchetV2).dhs, "the ratchet is running on both phones");
});

test("engine: paired phones move to the double ratchet as they chat", async () => {
  const { A, B, a, b } = await pair();
  for (let i = 0; i < 3; i++) {
    await A.e.send(a.id, "ping " + i); await flush();
    await B.e.send(b.id, "pong " + i); await flush();
  }
  const ra = A.e.state.contacts[a.id].ratchet as RatchetV2, rb = B.e.state.contacts[b.id].ratchet as RatchetV2;
  assert.equal(ra.v, 2); assert.ok(ra.dhs && rb.dhs && ra.peerV2 && rb.peerV2);
  assert.ok(B.e.state.contacts[b.id].messages.some((m) => m.text === "ping 2"));
  assert.ok(A.e.state.contacts[a.id].messages.some((m) => m.text === "pong 2"));
});

test("a phone holds at most 50 contacts; new pairings are refused until one is removed", async () => {
  const relay = new FakeRelay();
  const A = phone(relay);
  for (let i = 0; i < 50; i++) {
    const k = newKeyPair();
    A.e.state.contacts["c" + i] = { id: "c" + i, myPriv: k.priv, myPub: k.pub, theirPub: newKeyPair().pub } as never;
  }
  assert.equal(A.e.isFull(), true);
  assert.throws(() => A.e.createInvite(), /50 contacts/);
  const B = phone(relay);
  const { code } = B.e.createInvite();
  const r = await A.e.scan(code);
  assert.equal(r.ok, false);
  A.e.removeContact("c0");
  assert.equal(A.e.isFull(), false);
  assert.equal((await A.e.scan(code)).ok, true);
});

// ---------- group chats (VLABS-427) ----------
async function trio() {
  const relay = new FakeRelay();
  const A = phone(relay), B = phone(relay), C = phone(relay);
  const link = async (X: ReturnType<typeof phone>, Y: ReturnType<typeof phone>) => {
    const { code, invite } = X.e.createInvite();
    await Y.e.scan(code); await flush();
    await X.e.acceptRequest(invite.pub); await flush();
  };
  await link(A, B); await link(A, C);
  const ids = Object.keys(A.e.state.contacts);
  assert.equal(ids.length, 2);
  return { relay, A, B, C, ids };
}
const settle = async () => { for (let i = 0; i < 6; i++) await flush(); };

test("groups: the creator invites contacts, everyone joins and every member reads every message", async () => {
  const { A, B, C, ids } = await trio();
  const gid = (await A.e.createGroup(ids))!;
  assert.ok(gid);
  await settle();
  const gb = B.e.state.groups![gid], gc = C.e.state.groups![gid], ga = A.e.state.groups![gid];
  assert.ok(gb && gc, "both contacts were added");
  assert.equal(ga.members.length, 3);
  assert.equal(gb.members.length, 3, "the creator's roster reached B");
  await B.e.sendGroup(gid, "hello group from B"); await settle();
  assert.ok(A.e.state.groups![gid].messages.some((m) => m.text === "hello group from B"));
  assert.ok(C.e.state.groups![gid].messages.some((m) => m.text === "hello group from B" && m.from === gb.me.pub),
    "C reads B's message although B and C never paired");
  const m = C.e.state.groups![gid].messages[0];
  C.e.markGroupRead(gid, m.id);
  assert.ok(C.e.state.groups![gid].messages[0].expiresAt, "the timer runs once read");
  clock += 6 * 60_000; C.e.tick();
  assert.equal(C.e.state.groups![gid].messages.length, 0, "deleted after the timer");
});

test("groups: double-tap deletes my message everywhere; a non-member can't post", async () => {
  const { A, B, C, ids, relay } = await trio();
  const gid = (await A.e.createGroup(ids))!; await settle();
  const sent = (await A.e.sendGroup(gid, "oops"))!; await settle();
  assert.ok(B.e.state.groups![gid].messages.some((m) => m.id === sent.id));
  await A.e.deleteGroupNow(gid, sent.id); await settle();
  assert.ok(!B.e.state.groups![gid].messages.some((m) => m.id === sent.id));
  assert.ok(!C.e.state.groups![gid].messages.some((m) => m.id === sent.id));
  // someone who learned the group key but isn't on the roster
  const outsider = newKeyPair();
  const g = A.e.state.groups![gid];
  relay.publish(wrap(outsider.priv, g.gpub, JSON.stringify({ t: "gmsg", id: "x1", text: "spoof", ttl: 0, at: clock }), clock, clock + 60_000));
  await settle();
  assert.ok(!B.e.state.groups![gid].messages.some((m) => m.text === "spoof"));
});

test("groups: when a member leaves, the creator replaces the key and the leaver can't read on", async () => {
  const { A, B, C, ids } = await trio();
  const gid = (await A.e.createGroup(ids))!; await settle();
  const oldPriv = C.e.state.groups![gid].gpriv;
  await C.e.leaveGroup(gid); await settle();
  assert.equal(C.e.state.groups![gid], undefined);
  assert.notEqual(A.e.state.groups![gid].gpriv, oldPriv, "new group key");
  assert.equal(B.e.state.groups![gid].gpriv, A.e.state.groups![gid].gpriv, "B got the new key");
  assert.equal(A.e.state.groups![gid].members.length, 2);
  await A.e.sendGroup(gid, "after C left"); await settle();
  assert.ok(B.e.state.groups![gid].messages.some((m) => m.text === "after C left"));
});

test("groups: at most 8 people, and the creator leaving ends the group", async () => {
  const { A, B, ids } = await trio();
  assert.equal(await A.e.createGroup(Array.from({ length: 8 }, (_, i) => ids[i % 2] + i)), null, "only real contacts");
  assert.equal(await A.e.createGroup([]), null);
  const gid = (await A.e.createGroup(ids))!; await settle();
  await A.e.leaveGroup(gid); await settle();
  assert.equal(B.e.state.groups![gid].ended, true);
  assert.equal(await B.e.sendGroup(gid, "anyone?"), null);
});
