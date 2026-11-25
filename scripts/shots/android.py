"""Drive the Ashnote screenshot build on an Android emulator and save documentation screenshots.

Runs inside .github/workflows/screenshots.yml after the APK is installed. The "other phone" is
scripts/shots/peer.ts (an Ashnote engine in Node on the same local relay); this script sends it
commands through a file. Taps go by the text or accessibility label that uiautomator reports.
Usage: python3 scripts/shots/android.py <out-dir> <peer-command-file>
"""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
CMD = Path(sys.argv[2])
PKG = "com.velosolabs.ashnote"


def adb(*args, check=True):
    return subprocess.run(["adb", *args], capture_output=True, check=check)


def nodes():
    for _ in range(5):
        adb("shell", "rm", "-f", "/sdcard/ui.xml", check=False)
        r = adb("shell", "uiautomator", "dump", "--compressed", "/sdcard/ui.xml", check=False)
        x = adb("exec-out", "cat", "/sdcard/ui.xml", check=False).stdout
        if x.strip().startswith(b"<?xml"):
            return list(ET.fromstring(x).iter("node"))
        time.sleep(1)
    raise RuntimeError("uiautomator dump failed: " + r.stderr.decode())


def find(match, timeout=30, prefix=False):
    end = time.time() + timeout
    while time.time() < end:
        for n in nodes():
            for key in ("text", "content-desc"):
                v = n.get(key) or ""
                if v == match or (prefix and v.startswith(match)):
                    return n
        time.sleep(0.7)
    adb("exec-out", "screencap", "-p", check=False)
    shot("zz-missing-" + re.sub(r"\W+", "-", match)[:30])
    raise RuntimeError(f"not on screen: {match!r}")


def tap(match, **kw):
    n = find(match, **kw)
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds")))
    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
    time.sleep(0.8)


def shot(name, settle=1.5):
    time.sleep(settle)
    png = adb("exec-out", "screencap", "-p").stdout
    (OUT / f"{name}.png").write_bytes(png)
    print("shot", name, len(png))


def peer(line):
    with CMD.open("a") as f:
        f.write(line + "\n")


def invite_code(timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        log = adb("logcat", "-d", "-s", "ReactNativeJS:*", check=False).stdout.decode(errors="ignore")
        m = re.findall(r"ASHNOTE_INVITE (ashnote:1:[A-Za-z0-9_\-]+)", log)
        if m:
            return m[-1]
        time.sleep(0.5)
    raise RuntimeError("invite code not in the log")


# a tidy status bar
adb("shell", "settings", "put", "global", "sysui_demo_allowed", "1", check=False)
for extra in (["-e", "command", "enter"], ["-e", "command", "clock", "-e", "hhmm", "0945"],
              ["-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false"],
              ["-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4"],
              ["-e", "command", "notifications", "-e", "visible", "false"]):
    adb("shell", "am", "broadcast", "-a", "com.android.systemui.demo", *extra, check=False)

adb("logcat", "-c", check=False)
adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
find("Show invite code", timeout=90)
shot("android-home-empty", settle=3)

tap("Show invite code")
find("Invite code")
shot("android-invite")

peer("scan " + invite_code())
find("They match, accept", timeout=40)
shot("android-safety-code")
tap("They match, accept")

find("Message", timeout=40)
time.sleep(3)
peer("msg Hi! Got your code. This message deletes itself 5 minutes after you read it.")
find("Hi! Got your code. This message deletes itself 5 minutes after you read it.", timeout=40)
shot("android-chat", settle=2.5)

peer("sos")
find("Close", timeout=40)
shot("android-sos")
tap("Close")

tap("Back to contacts")
find("Show invite code")
shot("android-contacts")

tap("Settings")
find("Sounds", timeout=20, prefix=True)
shot("android-settings")
tap("Back")

for _ in range(3):  # System -> Light -> Dark
    n = find("Colour mode:", prefix=True)
    if (n.get("content-desc") or "").startswith("Colour mode: Dark"):
        break
    tap("Colour mode:", prefix=True)
shot("android-contacts-dark")
print("done")
