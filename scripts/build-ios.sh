#!/bin/bash
# Build the iOS dev client and install on simulator
cd "$(dirname "$0")/../app/ios"

DEVICE_ID=$(xcrun simctl list devices booted -j | python3 -c "import sys,json; devs=json.load(sys.stdin)['devices']; print([d['udid'] for r in devs.values() for d in r if d['state']=='Booted'][0])" 2>/dev/null)

if [ -z "$DEVICE_ID" ]; then
  echo "No booted simulator found"
  exit 1
fi

echo "Building for simulator $DEVICE_ID..."
xcodebuild -workspace rntestharness.xcworkspace \
  -scheme rntestharness \
  -destination "id=$DEVICE_ID" \
  -sdk iphonesimulator \
  ONLY_ACTIVE_ARCH=YES \
  build 2>&1 | tail -5

# Find and install the built app
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData/rntestharness-*/Build/Products/Debug-iphonesimulator -name "rntestharness.app" -type d 2>/dev/null | head -1)

if [ -n "$APP_PATH" ]; then
  echo "Installing $APP_PATH..."
  xcrun simctl install "$DEVICE_ID" "$APP_PATH"
  echo "Launching..."
  xcrun simctl launch "$DEVICE_ID" com.test.rnharness
else
  echo "App not found in DerivedData"
  exit 1
fi
