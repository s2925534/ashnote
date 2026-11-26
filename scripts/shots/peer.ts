// The "other phone" for documentation screenshots: an Ashnote engine running in Node
// against a local relay. It takes commands, one per line, from a file it watches:
//   scan <code>      pair with the invite code shown on the emulator
//   msg <text>       send a message to the paired contact
//   sos              send an SOS with a fixed demo location (Brisbane)
//   photo <1|2>      send one of the test photos in scripts/shots
//   gmsg <text>      once the emulator has added us to a group (we join on our own), send to it
// and prints every notice it gets, so the driver script can wait for "paired".
// Usage: npx tsx scripts/shots/peer.ts <relay-url> <command-file>
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Engine, emptyState } from "../../src/core/engine";
import { NostrTransport } from "../../src/lib/transport";

const [relay = "ws://localhost:7777", cmdFile = "peer-commands.txt"] = process.argv.slice(2);
const transport: NostrTransport = new NostrTransport((): string[] => engine.state.relays);
const engine: Engine = new Engine(emptyState([relay]), { transport, now: () => Date.now(), save: () => {} });
engine.start();
setInterval(() => {
  engine.tick();
  for (const n of engine.takeNotices()) console.log("NOTICE", JSON.stringify(n));
}, 300);

let done = 0;
const contact = () => Object.keys(engine.state.contacts)[0];
async function run(line: string) {
  const [cmd, ...rest] = line.trim().split(" ");
  // wait (up to 30 s) for the pairing to finish before messaging
  for (let i = 0; cmd !== "scan" && !contact() && i < 100; i++) await new Promise((r) => setTimeout(r, 300));
  const arg = rest.join(" ");
  if (cmd === "scan") console.log("SCAN", JSON.stringify(await engine.scan(arg)));
  if (cmd === "msg" && contact()) console.log("SENT", !!(await engine.send(contact(), arg, { keepCopy: true })));
  if (cmd === "photo" && contact()) {
    const b64 = readFileSync(join(__dirname, `photo${arg === "2" ? 2 : 1}.jpg`)).toString("base64");
    console.log("PHOTO", !!(await engine.sendImage(contact(), b64, 720, 960, { keepCopy: true })));
  }
  if (cmd === "gmsg") {
    for (let i = 0; !engine.groupList().length && i < 300; i++) await new Promise((r) => setTimeout(r, 300));
    const g = engine.groupList()[0];
    // give our join a moment to reach the group's creator, who adds us to the member list
    await new Promise((r) => setTimeout(r, 4000));
    console.log("GSENT", !!(g && (await engine.sendGroup(g.id, arg))));
  }
  if (cmd === "sos" && contact()) {
    const loc = { lat: -27.4698, lon: 153.0251, acc: 12, at: Date.now() };
    console.log("SOS", await engine.sendAlert([contact()], "sos", loc, true));
  }
}
setInterval(async () => {
  if (!existsSync(cmdFile)) return;
  const lines = readFileSync(cmdFile, "utf8").split("\n").filter(Boolean);
  while (done < lines.length) await run(lines[done++]);
}, 300);
console.log("READY", relay);
