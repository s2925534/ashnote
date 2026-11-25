#!/usr/bin/env bash
# Runs inside the emulator step of .github/workflows/screenshots.yml.
set -euo pipefail
OUT=${1:-shots}
node scripts/dev-relay.js 7777 > relay.log 2>&1 &
rm -f peer-commands.txt
npx tsx scripts/shots/peer.ts ws://localhost:7777 peer-commands.txt > peer.log 2>&1 &
adb reverse tcp:7777 tcp:7777
adb install -r -g android/app/build/outputs/apk/release/app-release.apk
python3 scripts/shots/android.py "$OUT" peer-commands.txt || { echo "--- peer.log"; cat peer.log; echo "--- app log"; adb logcat -d -s ReactNativeJS:* | tail -50; exit 1; }
cat peer.log
