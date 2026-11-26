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

**Groups** (0.4.0, VLABS-427). Up to 8 members, 20 groups per phone, text only. The creator makes a
group key pair and a member key for itself, then sends the group private key to each invited contact
over their pairwise Double Ratchet channel (`ginv`). Each member answers with a fresh member key for
this group (`gjoin`), and the creator publishes the member list (`groster`). Group messages are gift
wraps addressed to the group public key and sealed with the sender's member key; a receiver drops
anything not sealed by a listed member, and only the creator may change the list or end the group
(`gend`). When someone leaves (`gleave`) the creator makes a new group key and sends it to the
remaining members over their pairwise channels (`gkey`), so a member who left can't read later
messages. Limitation: group messages use one static group key between rekeys, so they get no
per-message forward secrecy; a phone that is compromised while in a group exposes that group's
messages until the next rekey.

**App lock** (0.5.0, VLABS-459, the mobile app lock standard). A PIN of 4 to 8 digits is chosen on first
run (existing installs are asked on their next open). It is stored only as PBKDF2-SHA256 (10,000
iterations from 0.5.3, 16-byte random salt) in the phone's secure storage (Keystore / Keychain, this device only),
separate from the database. The lock runs before the encrypted database is opened and the engine starts,
and again after a minute in the background (the engine and relay connections stop while locked). After 5
wrong tries each wrong try starts a wait (30 s, then 1 min, then 5 min, then 15 min each, as the
mobile app lock standard sets); the count and the wait are
stored, so restarting doesn't skip them, and no PIN is checked during a wait. Optional fingerprint or face
unlock. Forgot PIN: the phone's own owner check (biometrics or its passcode) lets you choose a new PIN; if
the phone has no screen lock, or you can't pass it, Reset Ashnote deletes the database contents, the PIN
and the settings. There is no account, so nothing is recoverable from a server. Every lock event (PIN chosen or changed, a
phone-owner reset, an Ashnote reset, a wait starting) is recorded on the phone only (secure storage,
last 50, kept across a reset) and listed in Settings > App lock (0.5.2).

**The lock releases the database key** (0.6.0, VLABS-464). Until 0.5.3 the SQLCipher key sat in secure storage
on its own, so the PIN only guarded the screens. From 0.6.0 the key is stored only in two sealed forms, and the
database can't be opened until one of them is opened:
- *By the PIN:* the PBKDF2 output is a master secret kept only in memory. HKDF-SHA256 derives a check value
  (stored, to count wrong tries) and a wrapping key. The database key is sealed with AES-256-GCM under the wrapping
  key (a v2 PIN record, `src/core/pinlock.ts`).
- *By the phone owner check:* a second copy in the phone-owner vault (`modules/ashnote-vault`, a small native module).
  - On Android it is encrypted with the public half of an RSA-2048 key pair (OAEP) in the Android Keystore. The
    private half needs user authentication and only decrypts for 15 seconds after a Class 3 fingerprint or face,
    or the screen lock PIN, pattern or password. The Keystore deletes it for good if the screen lock is removed.
  - On iPhone it is a Keychain item with the user-presence access control (Face ID, Touch ID or the passcode), this
    device only, and only while a passcode is set.
  - Sealing needs no prompt. The vault copy is made or refreshed whenever the PIN unlocks and the phone has a screen
    lock.

"Unlock with fingerprint or face" and Forgot PIN open the vault, so a Forgot PIN reset keeps the chats. If the phone
had no screen lock when Ashnote was last unlocked, only the PIN can open the data, and Reset Ashnote deletes the
database file. Relocking after a minute in the background closes the database and forgets the key.

The first unlock after updating from 0.5.3 or earlier seals the old key both ways and deletes the plain copy. Settings >
App lock then shows "Data key moved behind the lock".

Limits:
- A short PIN gives a small search space. Someone who extracts the PIN record from the hardware-backed secure storage
  could try every 4-digit PIN offline, so the secure storage and the enforced waits remain the main protection. A
  longer PIN helps.
- On Android, the screen lock unlock itself counts as an owner check for the 15-second window. Anyone who knows the
  phone's screen lock can open Ashnote's data, which is the trade-off of option B (the phone passcode is accepted on
  purpose).

Why 10,000 rounds: the app runs PBKDF2 in JavaScript on Hermes, which has no JIT, so 150,000 rounds took over 15
seconds on a phone and the PIN screen looked stuck (found in real-phone testing on 2026-11-26). With a 4-digit PIN
(10,000 possibilities) extra rounds add little against someone who has already extracted the record from secure
storage; the protection is the hardware-backed storage plus the stored, enforced waits. Records saved with the old
setting are re-saved at the next unlock.

**No identifier leaves the app** (0.6.1, VLABS-446). Downloads come from the VelosoLabs app store, which asks for a free
VelosoLabs account, but the app never asks for one, holds no store, account or install identifier, and opens only fixed
addresses (`src/core/links.ts`) with no query string. Relays see only gift-wrapped events tagged with a per-contact key
and an expiry. `tests/privacy.test.ts` and the relay-traffic test in `tests/engine.test.ts` check this.

**Contacts**. At most 50 contacts per phone (owner decision, 2026-11-26).

**Sign-in: exempt from the login standard** (owner decision, 2026-11-26). Pedro's web apps must have
their own email/password, passkey and emailed-code sign-in. Ashnote is a phone app with no accounts,
no server and no email address by design: each contact is a fresh key pair kept in the phone's
encrypted store, so there is nothing to sign in to. The phone's own lock screen protects the app.

## Known limitations and questions for the reviewer

- Groups have no per-message forward secrecy between rekeys (see Groups above).

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
