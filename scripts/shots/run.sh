#!/usr/bin/env bash
# Runs inside the emulator step of .github/workflows/screenshots.yml. Maestro drives the app
# (it copes with the countdowns that stop uiautomator); scripts/shots/peer.ts is the other phone.
set -euo pipefail
mkdir -p shots
export PATH="$HOME/.maestro/bin:$PATH"
node scripts/dev-relay.js 7777 > relay.log 2>&1 &
rm -f peer-commands.txt
npx tsx scripts/shots/peer.ts ws://localhost:7777 peer-commands.txt > peer.log 2>&1 &
adb reverse tcp:7777 tcp:7777
adb install -r -g android/app/build/outputs/apk/release/app-release.apk

# tidy status bar
adb shell settings put global sysui_demo_allowed 1
for a in "-e command enter" "-e command clock -e hhmm 0945" "-e command battery -e level 100 -e plugged false" \
         "-e command network -e wifi show -e level 4" "-e command notifications -e visible false"; do
  adb shell am broadcast -a com.android.systemui.demo $a > /dev/null || true
done

fail() { echo "FAILED: $1"; echo "--- peer.log"; cat peer.log; echo "--- relay.log"; tail -20 relay.log
         echo "--- app log"; adb logcat -d -s ReactNativeJS:* ReactNative:* | tail -60; exit 1; }
flow() { maestro test "scripts/shots/maestro/$1.yaml" || fail "$1"; }

adb logcat -c
flow 1-start
CODE=$(adb logcat -d -s ReactNativeJS:* | grep -o 'ashnote:1:[A-Za-z0-9_-]*' | tail -1)
[ -n "$CODE" ] || fail "no invite code in the log"
echo "scan $CODE" >> peer-commands.txt
flow 2-accept
sleep 3
echo "msg Hi! Got your code. This message deletes itself 5 minutes after you read it." >> peer-commands.txt
flow 3-chat
echo "sos" >> peer-commands.txt
flow 4-rest
cat peer.log
ls -la shots
