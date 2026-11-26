#!/usr/bin/env bash
# VLABS-464 upgrade and recovery test, run inside the emulator step of .github/workflows/lock-test.yml.
# old.apk is 0.5.3 (database key in secure storage on its own), new.apk is this branch; both are
# screenshot builds signed with the same debug key, so new.apk installs over old.apk like an update.
set -euo pipefail
mkdir -p shots
export PATH="$HOME/.maestro/bin:$PATH"
node scripts/dev-relay.js 7777 > relay.log 2>&1 &
rm -f peer-commands.txt
npx tsx scripts/shots/peer.ts ws://localhost:7777 peer-commands.txt > peer.log 2>&1 &
adb reverse tcp:7777 tcp:7777
collect() { find "$PWD" "$HOME/.maestro" -name 'lock-test-*.png' -not -path "$PWD/shots/*" -not -path '*/node_modules/*' -exec mv {} shots/ \; 2>/dev/null || true; }
fail() { collect; adb exec-out screencap -p > "shots/lock-test-zz-failed-$1.png" || true; echo "FAILED: $1"
         echo "--- app log"; adb logcat -d -s ReactNativeJS:* ReactNative:* AndroidRuntime:* | tail -80; exit 1; }
flow() { maestro test "scripts/shots/maestro/$1.yaml" || fail "$1"; }

# 1. 0.5.3: choose PIN 2468 and pair with the scripted second phone
adb install -r -g old.apk
sleep 5
adb logcat -c
flow 0-lock
flow 1-start
CODE=$(adb logcat -d -s ReactNativeJS:* | grep -o 'ashnote:1:[A-Za-z0-9_-]*' | tail -1)
[ -n "$CODE" ] || fail "no invite code in the log"
echo "scan $CODE" >> peer-commands.txt
flow 2-accept

# 2. the phone gets a screen lock (PIN 1111), then this build installs over 0.5.3
adb shell locksettings set-pin 1111
adb install -r -g new.apk
flow u2-upgrade
flow u3-forgot
collect
ls -la shots
