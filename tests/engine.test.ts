import assert from "node:assert/strict";
import { test } from "node:test";
import type { NostrEvent } from "nostr-tools/pure";
import { Engine, effectiveTtl, stackOf, type Transport } from "../src/core/engine";
import { aliasFor, safetyCode } from "../src/core/identity";
import { decodeInvite } from "../src/core/invite";
import { initRatchet, ratchetDecrypt, ratchetEncrypt } from "../src/core/ratchet";
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
  let sx = initRatchet(x.priv, x.pub, y.pub), sy = initRatchet(y.priv, y.pub, x.pub);
  const sealed: { n: number; c: string }[] = [];
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
