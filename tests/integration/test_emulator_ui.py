"""The AVD helper must never act on an XML dump left by an earlier run."""
import runpy
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


class FreshSnapshotTest(unittest.TestCase):
    def test_clickable_button_wins_over_identical_heading(self):
        commands = []
        def adb(command, **kwargs):
            commands.append(command)
            if command[-3:] == ["emu", "avd", "name"]: return b"GHGFlixStability\nOK\n"
            if "uiautomator" in command: return b"UI hierarchy dumped to: fixture"
            if "cat" in command: return b'<hierarchy><node text="Open" clickable="false" bounds="[0,0][10,10]"/><node text="Open" clickable="true" bounds="[10,20][50,60]"/></hierarchy>'
            return b""
        with patch.object(subprocess, "check_output", side_effect=adb), patch.object(sys, "argv", ["emulator-ui.py", "tap", "Open"]), patch.object(Path, "write_bytes"):
            runpy.run_path(str(Path(__file__).with_name("emulator-ui.py")))
        self.assertEqual(commands[-1][-5:], ["shell", "input", "tap", "30", "40"])

    def test_failed_dump_cannot_read_old_xml(self):
        commands = []

        def adb(command, **kwargs):
            commands.append(command)
            if command[-3:] == ["emu", "avd", "name"]:
                return b"GHGFlixStability\nOK\n"
            if "uiautomator" in command:
                # Android's real failure: exit code zero, no successful dump.
                return b""
            if "cat" in command:
                self.fail("Must not read stale XML after failed dump")
            if "rm" in command:
                return b""
            self.fail(f"Unexpected command: {command}")

        with patch.object(subprocess, "check_output", side_effect=adb), patch.object(sys, "argv", ["emulator-ui.py", "dump"]):
            with self.assertRaisesRegex(RuntimeError, "No fresh UI snapshot"):
                runpy.run_path(str(Path(__file__).with_name("emulator-ui.py")))
        dumped = next(c[-1] for c in commands if "uiautomator" in c)
        self.assertRegex(dumped, r"^/sdcard/ghgflix-ui-[0-9a-f]{32}\.xml$")
        self.assertEqual(commands[-1][-3:], ["rm", "-f", dumped])


if __name__ == "__main__":
    unittest.main()
