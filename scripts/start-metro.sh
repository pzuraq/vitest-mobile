#!/bin/bash
# Start Metro with clean cache, logging to /tmp/metro-output.log
# Kill any existing Metro first
lsof -ti:8081 | xargs kill 2>/dev/null
sleep 1
cd "$(dirname "$0")/../app"
npx expo start --clear --dev-client 2>&1 | tee /tmp/metro-output.log
