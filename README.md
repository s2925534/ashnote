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
| A new key pair per contact | `Engine.scan`, `Engine.acceptRequest` |
| Forward secrecy: a hash ratchet per direction, a new key per message | `src/core/ratchet.ts` |
| Sender hidden from relays: rumor, seal, gift wrap with a throwaway key and an expiry tag | `src/core/wrap.ts` |
| Delete after reading (default 5 min, shorter setting wins), double-tap delete on both phones, unsend | `src/core/engine.ts` |
| One message on screen at a time; the one underneath only counts as read when it surfaces | `src/screens/Chat.tsx` |
| Decode-in and dissolve-out animations (Reduce Motion gets fades) | `src/ui/MessageCard.tsx`, `src/ui/Particles.tsx` |
| Encrypted local storage (SQLCipher, key in Keychain/Keystore), no backups | `src/lib/storage.ts`, `app.json` |
| Screenshots blocked on Android; on iPhone the other person is told | `App.tsx`, `src/screens/Chat.tsx` |

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
Release, and publishes the APK to velosolabs.com/ashnote/download. Store submissions (App Store,
Google Play, F-Droid) are owner actions: VLABS-410, VLABS-411, VLABS-412.

Secrets: `ASHNOTE_KEYSTORE_BASE64`, `ASHNOTE_KEYSTORE_PASSWORD`, `ASHNOTE_KEY_ALIAS`,
`ASHNOTE_KEY_PASSWORD`, `HUB_ADMIN_TOKEN`.

## Licence

Proprietary. See `LICENSE`.
