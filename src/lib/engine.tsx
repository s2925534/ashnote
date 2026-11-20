// Holds the one Engine for the app, keeps its clock ticking, and re-renders on change.
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { Engine, emptyState, type Notice } from "../core/engine";
import { loadState, saveState } from "./storage";
import { NostrTransport } from "./transport";

type Ctx = { engine: Engine; transport: NostrTransport; now: number; notices: Notice[]; clearNotices: () => void };
const EngineContext = createContext<Ctx | null>(null);

export function EngineProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [ready, setReady] = useState<{ engine: Engine; transport: NostrTransport } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [notices, setNotices] = useState<Notice[]>([]);
  const engineRef = useRef<Engine | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await loadState();
      if (cancelled) return;
      const transport = new NostrTransport(() => engineRef.current?.state.relays ?? []);
      // EXPO_PUBLIC_RELAYS (comma-separated) overrides the default relays, for tests and previews.
      const override = process.env.EXPO_PUBLIC_RELAYS?.split(",").map((r: string) => r.trim()).filter(Boolean);
      const engine = new Engine(state ?? (override?.length ? emptyState(override) : null), { transport, now: () => Date.now(), save: saveState });
      engineRef.current = engine;
      engine.tick();
      engine.start();
      setReady({ engine, transport });
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const { engine, transport } = ready;
    const collect = () => {
      const n = engine.takeNotices();
      if (n.length) setNotices((prev) => [...prev, ...n]);
    };
    const unsub = engine.subscribe(collect);
    const id = setInterval(() => { engine.tick(); setNow(Date.now()); collect(); }, 500);
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") { engine.tick(); transport.resubscribe(); engine.flushOutbox(); setNow(Date.now()); }
    });
    return () => { unsub(); clearInterval(id); app.remove(); };
  }, [ready]);

  if (!ready) return <>{fallback}</>;
  return (
    <EngineContext.Provider value={{ ...ready, now, notices, clearNotices: () => setNotices([]) }}>
      {children}
    </EngineContext.Provider>
  );
}

export function useEngine(): Ctx {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error("useEngine outside EngineProvider");
  // re-render whenever the engine changes
  useSyncExternalStore(
    (cb) => { const u = ctx.engine.subscribe(cb); return () => { u(); }; },
    () => ctx.engine.state.seq + Object.keys(ctx.engine.state.contacts).length * 1e6 + versionOf(ctx.engine),
  );
  return ctx;
}

// a cheap change counter: bumps on every engine change
const versions = new WeakMap<Engine, number>();
function versionOf(e: Engine): number {
  if (!versions.has(e)) {
    versions.set(e, 0);
    e.subscribe(() => versions.set(e, (versions.get(e) ?? 0) + 1));
  }
  return versions.get(e) ?? 0;
}
