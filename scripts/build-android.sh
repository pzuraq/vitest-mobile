#!/bin/bash
# Build the Android dev client, install on emulator, and verify it runs.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
APP_DIR="$PROJECT_ROOT/app"
BUNDLE_ID="com.test.rnharness"

# Check for an online device/emulator
if ! adb devices 2>/dev/null | grep -q "device$"; then
  echo "No Android device/emulator found."
  echo "Start one with: \$ANDROID_HOME/emulator/emulator -avd <name>"
  exit 1
fi

echo "==> Running Expo prebuild (Android)..."
cd "$APP_DIR"
npx expo prebuild --platform android --clean 2>&1

echo ""
echo "==> Building Android app..."
cd "$APP_DIR/android"
./gradlew :app:assembleDebug 2>&1 | tail -20
echo ""

APK_PATH="$APP_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK_PATH" ]; then
  echo "ERROR: APK not found at $APK_PATH"
  exit 1
fi

echo "==> Installing APK..."
adb install -r "$APK_PATH" 2>&1
echo ""

echo "==> Setting up ADB port reverse..."
adb reverse tcp:7878 tcp:7878 2>/dev/null
adb reverse tcp:8081 tcp:8081 2>/dev/null

echo "==> Launching app..."
adb shell am force-stop "$BUNDLE_ID" 2>/dev/null
sleep 1
adb shell am start -n "$BUNDLE_ID/.MainActivity" -a android.intent.action.MAIN 2>&1

echo ""
echo "==> Android app built and launched."
echo "    Bundle ID: $BUNDLE_ID"
echo "    APK: $APK_PATH"
