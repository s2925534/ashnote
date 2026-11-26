// Web build (used only for previews and documentation screenshots): keeps state in
// memory, so nothing is stored in the browser.
import type { State } from "../core/engine";

let memory: State | null = null;
export async function loadState(): Promise<State | null> {
  return memory;
}
export function saveState(s: State) {
  memory = s;
}
export async function eraseAll() {
  memory = null;
}

const settings: Record<string, string> = {};
export async function loadSetting(key: string): Promise<string | null> {
  return settings[key] ?? null;
}
export async function saveSetting(key: string, value: string) {
  settings[key] = value;
}

// The web build has no app lock; these keep the same shape as the phone version.
export function setDatabaseKey(_k: string) {}
export function databaseKey(): string | null { return null; }
export async function legacyKey(): Promise<string | null> { return null; }
export async function deleteLegacyKey() {}
export function lockDatabase() {}
export async function destroyDatabase() { memory = null; }
export async function loadDeviceSetting(name: string): Promise<string | null> { return settings["device:" + name] ?? null; }
export async function saveDeviceSetting(name: string, value: string) { settings["device:" + name] = value; }
