// A minimal in-memory Nostr relay for local testing and screenshots (never used in production).
// Usage: node scripts/dev-relay.js [port]   (default 7777)
const WS = require("ws");
const WebSocketServer = WS.WebSocketServer || WS.Server;
const port = Number(process.argv[2] || 7777);
const events = [];
const subs = new Map(); // ws -> Map(subId -> filters)

const matches = (e, f) =>
  (!f.kinds || f.kinds.includes(e.kind)) &&
  (!f.since || e.created_at >= f.since) &&
  (!f["#p"] || e.tags.some((t) => t[0] === "p" && f["#p"].includes(t[1])));

const wss = new WebSocketServer({ port });
wss.on("connection", (ws) => {
  subs.set(ws, new Map());
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const [type, ...rest] = msg;
    if (type === "EVENT") {
      const e = rest[0];
      if (!events.some((x) => x.id === e.id)) events.push(e);
      ws.send(JSON.stringify(["OK", e.id, true, ""]));
      for (const [client, s] of subs) for (const [id, filters] of s)
        if (filters.some((f) => matches(e, f))) client.send(JSON.stringify(["EVENT", id, e]));
    } else if (type === "REQ") {
      const [id, ...filters] = rest;
      subs.get(ws).set(id, filters);
      for (const e of events) if (filters.some((f) => matches(e, f))) ws.send(JSON.stringify(["EVENT", id, e]));
      ws.send(JSON.stringify(["EOSE", id]));
    } else if (type === "CLOSE") subs.get(ws).delete(rest[0]);
  });
  ws.on("close", () => subs.delete(ws));
});
console.log(`dev relay on ws://localhost:${port}`);
