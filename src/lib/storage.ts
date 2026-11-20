// Encrypted local storage. The engine state lives in a SQLCipher database whose key is
// made on first launch and kept in the phone's secure storage (Keychain / Keystore),
// readable only on this device and never backed up.
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import { getRandomValues } from "expo-crypto";
import type { State } from "../core/engine";

const KEY_NAME = "ashnote.dbkey.v1";
let db: SQLite.SQLiteDatabase | null = null;

async function databaseKey(): Promise<string> {
  const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  let key = await SecureStore.getItemAsync(KEY_NAME, opts);
  if (!key) {
    const bytes = getRandomValues(new Uint8Array(32));
    key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await SecureStore.setItemAsync(KEY_NAME, key, opts);
  }
  return key;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  const key = await databaseKey();
  db = SQLite.openDatabaseSync("ashnote.db");
  db.execSync(`PRAGMA key = "x'${key}'";`);
  db.execSync("PRAGMA secure_delete = ON;");
  db.execSync("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);");
  return db;
}

export async function loadState(): Promise<State | null> {
  const d = await open();
  const row = d.getFirstSync<{ v: string }>("SELECT v FROM kv WHERE k = ?", "state");
  return row ? (JSON.parse(row.v) as State) : null;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: State | null = null;
export function saveState(s: State) {
  pending = s;
  if (timer) return;
  timer = setTimeout(async () => {
    timer = null;
    const d = await open();
    if (pending) d.runSync("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", "state", JSON.stringify(pending));
  }, 250);
}

/** Wipe everything: keys, contacts and messages. */
export async function eraseAll() {
  const d = await open();
  d.execSync("DELETE FROM kv; VACUUM;");
}
