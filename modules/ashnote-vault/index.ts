// The phone-owner vault (VLABS-464): a copy of Ashnote's database key sealed so that only the phone's
// own owner check (fingerprint, face or the phone's passcode) can open it.
// - Android: an RSA key in the Android Keystore that can only decrypt for 15 s after the owner check.
//   Sealing uses the public half, so it needs no prompt.
// - iPhone: a Keychain item with the "user presence" access control; reading it shows Face ID,
//   Touch ID or the passcode prompt itself.
// The web build has no native module: everything reports "not available".
import { requireOptionalNativeModule } from "expo";

export type OpenResult =
  | { ok: true; secret: string }
  | { ok: false; error: "missing" | "cancelled" | "not-authenticated" | "invalidated" | "failed" };

type Native = {
  isAvailable(): Promise<boolean>;
  hasSecret(): Promise<boolean>;
  seal(secret: string): Promise<void>;
  open(reason: string): Promise<{ ok: boolean; secret?: string; error?: string }>;
  clear(): Promise<void>;
};

const native = requireOptionalNativeModule<Native>("AshnoteVault");

/** Whether this phone has a screen lock that can protect the vault. */
export async function isAvailable(): Promise<boolean> {
  try { return native ? await native.isAvailable() : false; } catch { return false; }
}
/** Whether a sealed key is waiting in the vault (never prompts). */
export async function hasSecret(): Promise<boolean> {
  try { return native ? await native.hasSecret() : false; } catch { return false; }
}
/** Seals a secret (replacing any earlier one). Needs no prompt. */
export async function seal(secret: string): Promise<void> {
  if (!native) throw new Error("The vault isn't available on this device.");
  await native.seal(secret);
}
/** Opens the vault. On Android call it right after a successful owner check; on iPhone it prompts. */
export async function open(reason: string): Promise<OpenResult> {
  if (!native) return { ok: false, error: "missing" };
  try {
    const r = await native.open(reason);
    if (r.ok && r.secret) return { ok: true, secret: r.secret };
    const e = r.error;
    return { ok: false, error: e === "missing" || e === "cancelled" || e === "not-authenticated" || e === "invalidated" ? e : "failed" };
  } catch { return { ok: false, error: "failed" }; }
}
export async function clear(): Promise<void> {
  try { await native?.clear(); } catch { /* nothing to clear */ }
}
