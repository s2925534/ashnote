# Ashnote

Private chat for iPhone and Android with no accounts and no server of ours. Two people pair once by
scanning a single-use QR code; messages travel end-to-end encrypted through public Nostr relays and
delete themselves after they are read. Product page and docs: https://velosolabs.com/ashnote.
Jira: VLABS-408 (epic).

## How it works

| Feature | Where |
|---|---|
| Single-use invite codes: one-off key + secret + 10-minute expiry; the key is deleted on first use | `src/core/invite.ts`, `Engine.onInviteEvent` |
| Safety code (4 symbols) and aliases made from keys, never typed | `src/core/identity.ts` |
| Pairing from a distance: Share invite link (10 min, 1 hour or 24 hours) or Paste a code; links open `velosolabs.com/ashnote/i#…` (the code stays after the #, never sent to the server) and go straight into the app (App Links, `ashnote://pair/…`); remote invites ask to compare the symbols on a call | `src/screens/Pairing.tsx`, `App.tsx`, `src/core/invite.ts`, `Engine.setInviteLifetime` |
| A new key pair per contact | `Engine.scan`, `Engine.acceptRequest` |
| End-to-end encryption with a Double Ratchet: a new key per message (forward secrecy) and a new ratchet key with each reply, so copied keys stop working (post-compromise security); contacts on older versions keep using the v1 chains | `src/core/ratchet.ts` |
| Security design for reviewers: threat model, protocol, limits | `docs/SECURITY.md` |
| Sender hidden from relays: rumor, seal, gift wrap with a throwaway key and an expiry tag | `src/core/wrap.ts` |
| Delete after reading (default 5 min, shorter setting wins), double-tap delete on both phones, unsend | `src/core/engine.ts` |
| One message on screen at a time; the one underneath only counts as read when it surfaces | `src/screens/Chat.tsx` |
| Decode-in and dissolve-out animations (Reduce Motion gets fades) | `src/ui/MessageCard.tsx`, `src/ui/Particles.tsx` |
| Encrypted local storage (SQLCipher, key in Keychain/Keystore), no backups | `src/lib/storage.ts`, `app.json` |
| Screen capture disabled on Android and iPhone (screenshots and recordings come out blank); an iPhone attempt is reported to the other person | `App.tsx`, `src/screens/Chat.tsx` |
| SOS (life-threatening) and Help (not) alerts: hold to send with the phone's location, to every contact from the home screen or one contact from a chat; full-screen alert with vibration on the other phone; kept until dismissed | `src/ui/AlertButtons.tsx`, `src/ui/AlertOverlay.tsx`, `Engine.sendAlert` |
| Photos: one per send, shrunk and re-encoded (hidden data such as GPS removed), sent encrypted in pieces through the relays; one on screen at a time, later ones queue behind it with a Show next photo button that deletes the current one for both phones; when its timer ends the next appears by itself; temporary files are deleted at once | `src/lib/photos.ts`, `Engine.sendImage`, `Engine.showNextImage` |
| Replying clears the screen (on by default, Settings): sending deletes the message being answered for both phones, and the sender keeps no copy | `src/lib/prefs.ts`, `src/screens/Chat.tsx`, `Engine.send(…, { keepCopy })` |
| Colour mode button (System, Light, Dark), remembered on the phone | `src/ui/kit.tsx`, `src/ui/theme.ts` |
| Notification sounds, all off by default, one switch per event in Settings | `src/lib/sounds.ts`, `src/screens/Settings.tsx`, `tools/make_sounds.py` |
| Pairing symbols show only while the code is valid: they explode if it expires unaccepted, and rise away with a tick once paired | `src/screens/Pairing.tsx`, `Engine.tick` |

`src/core` is plain TypeScript with no React Native imports, so the protocol is tested under Node.

## Develop

```bash
npm install
npm test            # engine tests: pairing, single use, timers, deletes, ratchet, wraps
npm run typecheck
npx expo run:android  # or run:ios (needs a development build: the app uses native modules)
```

Local relay for testing two devices or the web preview:

```bash
node scripts/dev-relay.js 7777
EXPO_PUBLIC_RELAYS=ws://localhost:7777 npx expo start --web
```

The web build is for previews and documentation screenshots only (state is kept in memory, and
the scan screen takes pasted code text).

## Release

CI (`.github/workflows/app.yml`) runs the tests on every push. A tag `vX.Y.Z` (matching
`app.json`) or a manual run builds the signed APK and AAB, attaches them to a private GitHub
Release, and publishes the APK to velosolabs.com/ashnote/download. Every new version goes up
there as soon as it's released (owner's rule, 2026-11-26), until the VelosoLabs app store is ready:
then the download page sends people to the store instead. The APK build (`EXPO_PUBLIC_DIST=apk`)
also shows a "Support Ashnote" tip link in Settings; the store AAB doesn't, since app stores don't
allow links to outside payments. Store submissions (App Store,
Google Play, F-Droid) are owner actions: VLABS-410, VLABS-411, VLABS-412.

Secrets: `ASHNOTE_KEYSTORE_BASE64`, `ASHNOTE_KEYSTORE_PASSWORD`, `ASHNOTE_KEY_ALIAS`,
`ASHNOTE_KEY_PASSWORD`, `HUB_ADMIN_TOKEN`.

## Licence

Proprietary. See `LICENSE`.
