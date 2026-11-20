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
