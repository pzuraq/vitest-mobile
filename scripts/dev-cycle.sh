#!/bin/bash
# Full dev cycle: build, install, start metro, launch app, wait, grab logs + screenshot
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/../app"

DEVICE_ID=$(xcrun simctl list devices booted -j | python3 -c "import sys,json; devs=json.load(sys.stdin)['devices']; print([d['udid'] for r in devs.values() for d in r if d['state']=='Booted'][0])" 2>/dev/null)

echo "==> Killing existing Metro..."
"$SCRIPT_DIR/kill-metro.sh"
sleep 1

echo "==> Starting Metro..."
(cd "$APP_DIR" && npx expo start --clear --dev-client 2>&1) | tee /tmp/metro-output.log &
METRO_PID=$!

echo "==> Waiting for Metro to be ready..."
for i in $(seq 1 30); do
  if curl -s "http://localhost:8081/status" 2>/dev/null | grep -q "packager-status:running"; then
    echo "==> Metro is ready"
    break
  fi
  sleep 2
done

echo "==> Launching app with Metro URL..."
# Terminate existing instance first
xcrun simctl terminate "$DEVICE_ID" com.test.rnharness 2>/dev/null || true
# Launch with the EX_DEV_CLIENT_URL environment variable
xcrun simctl launch --terminate-running-process "$DEVICE_ID" com.test.rnharness "EXDevClientUrl=http://127.0.0.1:8081" 2>&1 || true

echo "==> Waiting 25s for app to load and run..."
sleep 25

echo "==> Taking screenshot..."
"$SCRIPT_DIR/screenshot.sh"

echo "==> Metro logs (last 80 lines):"
"$SCRIPT_DIR/metro-logs.sh" 80

echo ""
echo "==> Metro still running (PID $METRO_PID). Kill with: ./scripts/kill-metro.sh"
