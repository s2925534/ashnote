// VLABS-446: Ashnote never sends a store, account or install identifier. The store download may ask for a
// VelosoLabs account, but the app itself has no such identifier and opens only fixed addresses.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { INVITE_LINK_BASE, LATEST_VERSION_URL, TIP_URL } from "../src/core/links";
import { createInvite, encodeInvite, extractInviteCode, inviteLink } from "../src/core/invite";

const ROOT = join(__dirname, "..");
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|kt|swift)$/.test(name)) out.push(p);
  }
  return out;
}
const SOURCES = [...files(join(ROOT, "src")), ...files(join(ROOT, "modules")), join(ROOT, "App.tsx")]
  .map((p) => ({ path: relative(ROOT, p).replace(/\\/g, "/"), text: readFileSync(p, "utf8") }));
// comments may name addresses (for example a reference to zqx.io); only code counts
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

test("the app makes no web requests of its own: no fetch, XMLHttpRequest or raw WebSocket", () => {
  for (const f of SOURCES) {
    const c = code(f.text);
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|\baxios\b|HttpURLConnection|URLSession|OkHttp/.test(c), `${f.path} makes a web request`);
    if (f.path !== "src/lib/transport.ts") assert.ok(!/new WebSocket|SimplePool/.test(c), `${f.path} opens its own connection`);
  }
});

test("every web address in the code is one of the fixed links (or a map of a shared location)", () => {
  const allowed = new Set(["src/core/links.ts", "src/core/invite.ts", "src/lib/maps.ts"]);
  for (const f of SOURCES) {
    if (/https?:\/\//.test(code(f.text))) assert.ok(allowed.has(f.path), `${f.path} has a web address of its own`);
  }
  for (const url of [INVITE_LINK_BASE, LATEST_VERSION_URL, TIP_URL]) {
    const u = new URL(url);
    assert.equal(u.protocol, "https:");
    assert.equal(u.search, "", `${url} has a query string`);
    assert.ok(!/[{}$]/.test(url), `${url} is built from a template`);
  }
  // pages open only through these constants
  for (const f of SOURCES) {
    for (const m of code(f.text).matchAll(/openURL\(([^)]*)\)/g)) {
      const arg = m[1].trim();
      const ok = /^(LATEST_VERSION_URL|TIP_URL)$/.test(arg) || (f.path === "src/lib/maps.ts");
      assert.ok(ok, `${f.path} opens ${arg}`);
    }
  }
});

test("no store, account or install identifier exists in the app", () => {
  const forbidden = /\b(account[_-]?id|accountId|install[_-]?id|installId|device[_-]?id|deviceId|advertisingId|getAndroidId|identifierForVendor|store[_-]?token|license[_-]?key|licenseKey|userEmail)\b/;
  for (const f of SOURCES) assert.ok(!forbidden.test(code(f.text)), `${f.path} mentions an identifier`);
});

test("invite links carry the code only after the #, which browsers never send to the server", () => {
  const inv = createInvite(["wss://relay.example"], Date.now());
  const link = inviteLink(encodeInvite(inv));
  const u = new URL(link);
  assert.equal(`${u.origin}${u.pathname}`, INVITE_LINK_BASE.slice(0, -1));
  assert.equal(u.search, "");
  assert.ok(u.hash.length > 1);
  assert.equal(extractInviteCode(u.hash.slice(1)), encodeInvite(inv));
});
