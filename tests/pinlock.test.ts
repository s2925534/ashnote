import assert from "node:assert/strict";
import { test } from "node:test";
import { PIN_ITERATIONS, FREE_TRIES, MAX_LOCK_EVENTS, MAX_WAIT_MS, addLockEvent, makeRecord, tryPin, validPin, waitAfter, type LockEvent } from "../src/core/pinlock";

const salt = new Uint8Array(16).fill(7);
const FAST = 1000; // fewer iterations to keep the tests quick

test("PINs are 4 to 8 digits", () => {
  for (const ok of ["1234", "00000000", "9876543"]) assert.ok(validPin(ok), ok);
  for (const bad of ["123", "123456789", "12a4", "", " 1234"]) assert.ok(!validPin(bad), bad);
});

test("only a salted hash is kept, and the right PIN unlocks", async () => {
  const r = await makeRecord("2468", salt, FAST);
  assert.ok(!JSON.stringify(r).includes("2468"));
  assert.equal(r.hash.length, 64);
  const other = await makeRecord("2468", new Uint8Array(16).fill(8), FAST);
  assert.notEqual(r.hash, other.hash); // a different salt gives a different hash
  const t = await tryPin(r, "2468", 0);
  assert.ok(t.ok);
});

test("wrong tries count down, then waits grow and are enforced", async () => {
  let r = await makeRecord("2468", salt, FAST);
  for (let i = 1; i < FREE_TRIES; i++) {
    const t = await tryPin(r, "0000", 0);
    assert.ok(!t.ok && t.waitMs === 0 && t.triesLeft === FREE_TRIES - i);
    r = t.record;
  }
  let t = await tryPin(r, "0000", 1000);
  assert.ok(!t.ok && t.waitMs === 30_000);
  r = t.record;
  // during the wait even the right PIN is not checked
  t = await tryPin(r, "2468", 2000);
  assert.ok(!t.ok && t.waitMs > 0 && t.record.fails === r.fails);
  // after the wait, the next wrong tries wait 1 min, then 5 min
  let now = 1000 + 30_000;
  for (const expected of [60_000, 300_000, 900_000, 900_000]) {
    t = await tryPin(r, "1111", now);
    assert.ok(!t.ok && t.waitMs === expected, `${t.ok ? "" : t.waitMs} != ${expected}`);
    r = t.record;
    now += expected;
  }
  // the right PIN after the wait resets everything
  t = await tryPin(r, "2468", now);
  assert.ok(t.ok && t.record.fails === 0 && t.record.waitUntil === 0);
});

test("waits follow the standard: 30 s, 1 min, 5 min, then 15 min each", () => {
  assert.equal(waitAfter(FREE_TRIES - 1), 0);
  assert.equal(waitAfter(50), MAX_WAIT_MS);
});

test("lock events are kept newest first, at most MAX_LOCK_EVENTS", () => {
  let list: LockEvent[] = [];
  for (let i = 0; i < MAX_LOCK_EVENTS + 5; i++) list = addLockEvent(list, { at: i, kind: "wait-started" });
  list = addLockEvent(list, { at: 999, kind: "phone-owner-reset" });
  assert.equal(list.length, MAX_LOCK_EVENTS);
  assert.equal(list[0].kind, "phone-owner-reset");
  assert.equal(list[1].at, MAX_LOCK_EVENTS + 4);
});

test("a PIN record remembers its length, and hashing stays fast enough for a phone", async () => {
  const r = await makeRecord("2468", salt);
  assert.equal(r.len, 4);
  assert.ok(PIN_ITERATIONS <= 20_000, "Hermes runs PBKDF2 without a JIT: keep the rounds low or the lock looks stuck");
  const t = Date.now();
  await makeRecord("246813", salt);
  assert.ok(Date.now() - t < 2000);
});

const KEY = "ab".repeat(32);
const NONCE = new Uint8Array(12).fill(3);

test("a v2 record seals the database key: only the right PIN releases it", async () => {
  const r = await makeRecord("2468", salt, FAST, KEY, NONCE);
  assert.equal(r.v, 2);
  assert.ok(r.wrapped && !r.wrapped.includes(KEY), "the key is never stored in the clear");
  const ok = await tryPin(r, "2468", 0);
  assert.ok(ok.ok && ok.dbKey === KEY);
  const bad = await tryPin(r, "1357", 0);
  assert.ok(!bad.ok && !("dbKey" in bad));
});

test("the check value doesn't reveal the wrapping key, and a tampered seal gives no key", async () => {
  const r = await makeRecord("2468", salt, FAST, KEY, NONCE);
  const v1 = await makeRecord("2468", salt, FAST);
  assert.notEqual(r.hash, v1.hash); // v2 keeps a derived check value, not the master secret
  const flip = r.wrapped!.slice(0, -2) + (r.wrapped!.endsWith("00") ? "01" : "00");
  const t = await tryPin({ ...r, wrapped: flip }, "2468", 0);
  assert.ok(t.ok && t.dbKey === undefined);
});

test("v1 records from 0.5.0 to 0.5.3 still unlock (and carry no key)", async () => {
  const r = await makeRecord("2468", salt, FAST);
  assert.equal(r.v, 1);
  const t = await tryPin(r, "2468", 0);
  assert.ok(t.ok && t.dbKey === undefined);
});
