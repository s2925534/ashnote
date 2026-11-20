// Small on-phone preferences (stored in the encrypted database).
import { loadSetting, saveSetting } from "./storage";

let replyClears = true; // "Replying clears the screen": on by default

export async function loadPrefs() {
  try {
    const v = await loadSetting("replyClears");
    if (v === "0" || v === "1") replyClears = v === "1";
  } catch {}
  return { replyClears };
}
export const getReplyClears = () => replyClears;
export async function setReplyClears(on: boolean) {
  replyClears = on;
  await saveSetting("replyClears", on ? "1" : "0").catch(() => {});
}
