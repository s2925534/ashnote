// Runs before anything else: makes the Web Crypto random source and Promise.any available
// to the crypto libraries on every platform.
import { getRandomValues } from "expo-crypto";

const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = getRandomValues as unknown;
}

if (typeof Promise.any !== "function") {
  (Promise as unknown as { any: unknown }).any = <T,>(ps: Promise<T>[]) =>
    new Promise<T>((resolve, reject) => {
      let left = ps.length;
      if (!left) reject(new Error("no promises"));
      ps.forEach((p) => p.then(resolve, () => { if (--left === 0) reject(new Error("all failed")); }));
    });
}
