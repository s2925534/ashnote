// Encrypted local storage. The engine state lives in a SQLCipher database. Since 0.6.0 (VLABS-464) its key
// is not kept anywhere in the clear: the app lock releases it (src/lib/lock.ts), either from the PIN record
// (sealed under a key derived from the PIN) or from the phone-owner vault (modules/ashnote-vault). Until the
// lock hands the key over with setDatabaseKey, every read and write here waits. Relocking closes the database
// and forgets the key again.
//
// 0.5.3 and earlier kept the key in secure storage on its own (LEGACY_KEY). The first unlock after the update
// moves it behind the lock and deletes that copy.
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { State } from "../core/engine";

const DB_NAME = "ashnote.db";
const LEGACY_KEY = "ashnote.dbkey.v1";
const secure = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

let db: SQLite.SQLiteDatabase | null = null;
let key: string | null = null;
let waiters: (() => void)[] = [];

/** The lock hands over the database key (hex) once the PIN or the owner check released it. */
export function setDatabaseKey(k: string) {
  key = k;
  const w = waiters; waiters = [];
  w.forEach((f) => f());
}
/** The key, while the app is unlocked (to seal it again under a new PIN or in the vault). */
export function databaseKey(): string | null {
  return key;
}

/** 0.5.3 and earlier: the key on its own in secure storage (null once it has moved behind the lock). */
export async function legacyKey(): Promise<string | null> {
  return SecureStore.getItemAsync(LEGACY_KEY, secure);
}
export async function deleteLegacyKey(): Promise<void> {
  await SecureStore.deleteItemAsync(LEGACY_KEY, secure);
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  if (!key) await new Promise<void>((resolve) => waiters.push(resolve));
  if (db) return db;
  db = SQLite.openDatabaseSync(DB_NAME);
  db.execSync(`PRAGMA key = "x'${key}'";`);
  db.execSync("PRAGMA secure_delete = ON;");
  db.execSync("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);");
  return db;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: State | null = null;
function writePending(d: SQLite.SQLiteDatabase) {
  if (pending) d.runSync("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", "state", JSON.stringify(pending));
  pending = null;
}

export async function loadState(): Promise<State | null> {
  const d = await open();
  writePending(d); // a save that was waiting for the unlock lands first
  const row = d.getFirstSync<{ v: string }>("SELECT v FROM kv WHERE k = ?", "state");
  return row ? (JSON.parse(row.v) as State) : null;
}

export function saveState(s: State) {
  pending = s;
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    writePending(await open());
  }, 250);
}

/** Relock: write anything pending, close the database and forget the key until the next unlock. */
export function lockDatabase() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (db) {
    try { writePending(db); } catch { /* kept in memory, written after the next unlock */ }
    try { db.closeSync(); } catch { /* already closed */ }
  }
  db = null;
  key = null;
}

/** Reset Ashnote: delete the database file itself (it can't be opened without the key) and forget the key. */
export async function destroyDatabase() {
  if (timer) { clearTimeout(timer); timer = null; }
  pending = null;
  if (db) { try { db.closeSync(); } catch { /* already closed */ } }
  db = null;
  key = null;
  try { SQLite.deleteDatabaseSync(DB_NAME); } catch { /* no database yet */ }
  await deleteLegacyKey().catch(() => {});
}

export async function loadSetting(key: string): Promise<string | null> {
  const d = await open();
  const row = d.getFirstSync<{ v: string }>("SELECT v FROM kv WHERE k = ?", "setting:" + key);
  return row ? row.v : null;
}
export async function saveSetting(key: string, value: string) {
  const d = await open();
  d.runSync("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", "setting:" + key, value);
}

// Settings the lock screen itself needs before the database is open (only the colour mode). Nothing private.
export async function loadDeviceSetting(name: string): Promise<string | null> {
  try { return await SecureStore.getItemAsync("ashnote.pref." + name, secure); } catch { return null; }
}
export async function saveDeviceSetting(name: string, value: string): Promise<void> {
  await SecureStore.setItemAsync("ashnote.pref." + name, value, secure).catch(() => {});
}
