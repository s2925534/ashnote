# Ashnote security design (reviewer brief)

For the independent review (VLABS-438) and anyone checking Ashnote's claims. Everything here is in
this repository; `src/core` is plain TypeScript with no React Native imports and is tested under Node
(`npm test`).

## What Ashnote promises

- Only the two paired phones can read a conversation. Relays carry ciphertext only.
- No accounts, phone numbers or email addresses; no server of ours carries messages.
- A key stolen later can't open earlier messages (forward secrecy).
- From 0.3.0, a phone whose keys were copied recovers: once it has sent a fresh ratchet key and the
  other phone has answered, the copied keys open nothing new (post-compromise security).
- Messages delete themselves after reading (default 5 minutes) on both phones.

What it doesn't promise: hiding that a phone talks to relays (IP addresses, timing and sizes are visible
to relays); protection on a phone that is unlocked and in someone else's hands; protection against a
person who accepts a pairing without comparing the symbols.

## Threat model

| Adversary | Can | Can't (by design) |
|---|---|---|
| Relay operator / network observer | See wrapped events: a recipient key per contact, size, time, the IP that publishes or subscribes | Read content, learn the sender (wraps are signed by a throwaway key), link a contact key to a person |
| Someone who reads an invite (QR photo, intercepted link) | Use it once, first, before the intended person | Use it after it is used, cancelled or expired; pass the 4-symbol check if the two people compare |
| Thief of a phone's state (keys) at time T | Read messages in flight at T and until the phone has replied on a fresh ratchet key | Read messages before T (deleted keys); keep reading after recovery |
| Another app on the phone | Nothing beyond what the OS allows | Read the database (SQLCipher, key in Keychain/Keystore), capture the screen (FLAG_SECURE / iOS capture protection) |

## Protocol

**Identity.** None global. Each contact gets a new secp256k1 key pair on each phone
(`Engine.scan`, `Engine.acceptRequest`). The alias shown is derived from the public key
(`src/core/identity.ts`).

**Pairing** (`src/core/invite.ts`, `Engine.scan/onInviteEvent/acceptRequest`).
1. The inviter makes a one-off key pair, a 128-bit random secret and an expiry (10 min, or 1 h / 24 h
   for shared links; decoders refuse more than 24 h). Code: `ashnote:1:` + base64url JSON
   `{k: one-off pub, s: secret, r: relays, e: expiry ms}`. QR and links carry
   `https://velosolabs.com/ashnote/i#<code>`; the code is in the fragment and never sent to the server.
2. The scanner makes its per-contact key pair and sends a request, gift-wrapped to the one-off key,
   containing the secret and its per-contact public key.
3. The inviter checks the secret and expiry, marks the invite used and deletes the one-off private key.
   Both phones show a safety code: 4 symbols from SHA-256 of the two keys
   (`safetyCode(invitePub, scannerPub)`). People compare them side by side, or on a call for links.
4. On accept, the inviter makes its own per-contact key pair and sends it to the scanner.

**Transport** (`src/core/wrap.ts`). Every message is a NIP-59-style gift wrap: rumor (kind 14,
unsigned, by the per-contact key) → seal (kind 13, signed by the per-contact key, NIP-44 v2 encrypted
to the recipient's per-contact key) → wrap (kind 1059, signed by a throwaway key, NIP-44 v2 encrypted,
`p` tag = recipient per-contact key, NIP-40 `expiration` 7 days). Relays: three public Nostr relays
by default (`DEFAULT_RELAYS`).

**Message encryption** (`src/core/ratchet.ts`). Inside the seal, the content is a sealed ratchet message.
- Message keys: chain key `ck` → message key `HMAC-SHA256(ck, 0x01)`, next chain key
  `HMAC-SHA256(ck, 0x02)`; payload encrypted with NIP-44 v2 under the message key.
- v2 Double Ratchet: root key `rk0 = HKDF(ECDH(per-contact keys), info "ashnote-dr-v2-root")`.
  `KDF_RK(rk, dh) = HKDF-SHA256(ikm dh, salt rk, info "ashnote-dr-v2", 64 bytes)` → new rk, chain key.
  ECDH = NIP-44 conversation key (HKDF-extract of the shared x coordinate). Header
  `{v: 2, dh: ratchet pub, pn, n}` travels inside the seal.
- Roles: the phone with the lower per-contact public key ("a") starts the ratchet with a fresh key against
  the other's per-contact key; "b" uses its per-contact key pair as its first ratchet key. This avoids both
  phones starting at once.
- v1 chains (two symmetric chains from the ECDH secret, info "ashnote-ratchet-v1") remain for: messages
  to and from phones on 0.1/0.2, and "b" sending before "a" has started. A v2 phone marks its v1
  messages with `cap: 2`; the ratchet starts only when "a" has seen that.
- Skipped keys: up to 200 per chain and 200 stored in total; each key works once.

**Deletion** (`Engine.markRead`, `tick`). A read receipt carries the effective timer (the shorter of
both settings); both phones delete text and photo data when it ends. Double-tap sends a delete;
unsending before the other phone opens it means it is never shown.

**Photos** (`src/lib/photos.ts`, `Engine.sendImage`). Re-encoded JPEG (1280 px, metadata stripped), split
into 16,000-character pieces, each a separate ratchet message and gift wrap. Temporary files are deleted.

**SOS / Help**. Ordinary ratchet messages with an `alert` body; location is read only when sending
(while the app is in use).

**On the phone**. `src/lib/storage.ts`: SQLCipher database, key in SecureStore (Keychain/Keystore).
`app.json`: `allowBackup: false`, no background location. `App.tsx`: `preventScreenCaptureAsync`
(FLAG_SECURE on Android; capture protection and app-switcher blur on iOS).

**Release**. `.github/workflows/app.yml`: tests, then a signed APK/AAB on a tag or manual run, published
to velosolabs.com with its SHA-256. Signing certificate SHA-256
`A6:02:48:0D:FF:33:3D:E4:B7:36:E5:FE:AA:1F:12:BE:F2:F7:A2:D8:3C:DE:62:81:A3:FC:6A:9B:C9:EC:18:47`.

## Known limitations and questions for the reviewer

- Metadata: relays see recipient contact keys, timing, sizes and IPs. Is the gift wrap plus per-contact
  keys enough, or should we pad sizes or add cover traffic?
- Pairing security rests on people comparing 4 symbols from 32 (20 bits, no modulo bias). An attacker gets one online try per invite.
- Using the NIP-44 conversation key as the ratchet DH output: confirm this is sound.
- The skipped-key cap (200) trades availability for memory; check the denial-of-service angle.
- Screen-capture protection depends on the OS; rooted devices can bypass it.

## Files

| Area | Files |
|---|---|
| Protocol core | `src/core/engine.ts`, `ratchet.ts`, `wrap.ts`, `invite.ts`, `identity.ts` |
| Tests | `tests/engine.test.ts` |
| Device | `src/lib/storage.ts`, `transport.ts`, `photos.ts`, `location.ts`, `App.tsx`, `app.json` |
| Release | `.github/workflows/app.yml`, `scripts/android-signing.js` |
