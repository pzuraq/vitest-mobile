#!/bin/bash
# Run Vitest end-to-end on Android.
# Prerequisites: Android emulator running, app already built and installed.
# The pool manages Metro + app launch + WebSocket relay.
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

# -- Preflight checks --
if ! adb devices 2>/dev/null | grep -q "device$"; then
  echo "ERROR: No Android device/emulator found."
  echo "Start one with: \$ANDROID_HOME/emulator/emulator -avd <name>"
  exit 1
fi

# Verify app is installed
if ! adb shell pm list packages 2>/dev/null | grep -q "com.vitest.mobile.harness"; then
  echo "ERROR: App not installed. Run: cd app && npx expo prebuild --platform android && npx expo run:android"
  exit 1
fi

# -- Clean up stale processes --
echo "==> Cleaning up stale processes..."
lsof -ti:7878 | xargs kill 2>/dev/null || true
lsof -ti:8081 | xargs kill 2>/dev/null || true
sleep 1

# -- ADB reverse for emulator --
echo "==> Setting up ADB port reverse..."
adb reverse tcp:7878 tcp:7878 2>/dev/null
adb reverse tcp:8081 tcp:8081 2>/dev/null

# -- Run tests --
echo "==> Running Vitest (Android)..."
cd "$PROJECT_ROOT"
timeout 180 npx vitest run --config vitest.config.android.ts --reporter=verbose 2>&1 | tee /tmp/vitest-android-output.log
EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "=== Vitest exit code: $EXIT_CODE ==="

# -- Screenshot --
echo "==> Taking screenshot..."
"$SCRIPT_DIR/screenshot-android.sh"

# -- Cleanup --
echo "==> Cleaning up..."
lsof -ti:7878 | xargs kill 2>/dev/null || true
lsof -ti:8081 | xargs kill 2>/dev/null || true

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo "=== TESTS PASSED ==="
else
  echo "=== TESTS FAILED (exit code: $EXIT_CODE) ==="
  echo "    Full log: /tmp/vitest-android-output.log"
  echo "    Screenshot: /tmp/android-screenshot.png"
fi
exit $EXIT_CODE
