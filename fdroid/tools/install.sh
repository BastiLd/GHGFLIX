#!/usr/bin/env bash
set -euo pipefail
python -m venv "$RUNNER_TEMP/fdroid-venv"
"$RUNNER_TEMP/fdroid-venv/bin/python" -m pip install --disable-pip-version-check --require-hashes -r fdroid/build-requirements.txt
"$RUNNER_TEMP/fdroid-venv/bin/python" -m pip install --disable-pip-version-check --require-hashes --no-build-isolation -r fdroid/requirements.txt
echo "$RUNNER_TEMP/fdroid-venv/bin" >> "$GITHUB_PATH"
if [[ ! -f "$ANDROID_HOME/build-tools/36.0.0/apksigner" ]]; then
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" 'build-tools;36.0.0'
fi
echo "$ANDROID_HOME/build-tools/36.0.0" >> "$GITHUB_PATH"
