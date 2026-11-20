// Talks to public Nostr relays. Relays only ever see gift-wrapped, encrypted events
// addressed to per-contact keys, with an expiry after which they drop them.
import { SimplePool, type SubCloser } from "nostr-tools/pool";
import type { NostrEvent } from "nostr-tools/pure";
import { WRAP_KIND } from "../core/wrap";
import type { Transport } from "../core/engine";

export class NostrTransport implements Transport {
  private pool = new SimplePool({ enablePing: true, enableReconnect: true });
  private sub: SubCloser | null = null;
  private cb: (e: NostrEvent) => void = () => {};
  private keys: string[] = [];
  private since = 0;

  constructor(private relays: () => string[]) {}

  onEvent(cb: (e: NostrEvent) => void) {
    this.cb = cb;
  }

  watch(keys: string[], sinceMs: number) {
    this.keys = keys;
    this.since = sinceMs;
    this.resubscribe();
  }

  resubscribe() {
    this.sub?.close();
    this.sub = null;
    if (!this.keys.length) return;
    this.sub = this.pool.subscribe(
      this.relays(),
      { kinds: [WRAP_KIND], "#p": this.keys, since: Math.floor(this.since / 1000) },
      { onevent: (e) => this.cb(e) },
    );
  }

  async publish(event: NostrEvent): Promise<boolean> {
    try {
      await Promise.any(this.pool.publish(this.relays(), event, { maxWait: 6000 }));
      return true;
    } catch {
      return false;
    }
  }

  /** How many relays are connected, for the status dot. */
  connected(): number {
    let n = 0;
    this.pool.listConnectionStatus().forEach((ok) => (n += ok ? 1 : 0));
    return n;
  }

  close() {
    this.sub?.close();
    this.pool.destroy();
  }
}
