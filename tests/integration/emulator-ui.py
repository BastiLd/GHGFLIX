"""Operate only the isolated, windowless GHGFlix test AVD, never a user device."""
import subprocess
import sys
import re
import os
from pathlib import Path
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding="utf-8")
sdk = Path(os.environ.get("ANDROID_HOME", str(Path(os.environ.get("LOCALAPPDATA", "")) / "Android/Sdk")))
adb = [str(sdk / "platform-tools/adb.exe"), "-P", "5041", "-s", "emulator-5568"]

def call(*args):
    return subprocess.check_output(adb + list(args), timeout=30)

assert call("emu", "avd", "name").decode().splitlines()[0].strip() == "GHGFlixStability", "Wrong emulator; refusing input"

def nodes():
    call("shell", "uiautomator", "dump", "/sdcard/ghgflix-ui.xml")
    xml = call("exec-out", "cat", "/sdcard/ghgflix-ui.xml")
    Path("test-results/emulator-ui.xml").write_bytes(xml)
    return list(ET.fromstring(xml).iter("node"))

action = sys.argv[1]
if action == "dump":
    for node in nodes():
        if node.get("text") or node.get("content-desc"):
            print(node.get("text"), node.get("content-desc"), node.get("bounds"), node.get("class"))
elif action == "tap":
    matches = [n for n in nodes() if sys.argv[2] in (n.get("text"), n.get("content-desc"))]
    assert matches, "Control not present: " + sys.argv[2]
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", matches[0].get("bounds")))
    call("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
elif action == "text":
    call("shell", "input", "text", sys.argv[2].replace(" ", "%s"))
elif action == "tap-video":
    # A hidden native video has no accessibility node. Only use its centre,
    # inside our own AVD, to test waking controls (never desktop input).
    size = call("shell", "wm", "size").decode().strip().splitlines()[-1]
    width, height = map(int, re.findall(r"(\d+)x(\d+)", size)[0])
    call("shell", "input", "tap", str(width // 2), str(height // 2))
elif action == "key":
    call("shell", "input", "keyevent", *sys.argv[2:])
elif action == "screenshot":
    target = Path("test-results") / Path(sys.argv[2]).name
    target.write_bytes(call("exec-out", "screencap", "-p"))
elif action == "swipe":
    call("shell", "input", "swipe", *sys.argv[2:])
else:
    raise ValueError(action)
