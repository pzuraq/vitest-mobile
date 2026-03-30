#!/bin/bash
# Export the iOS bundle to check for compile errors (no simulator needed)
cd "$(dirname "$0")/../app"
rm -rf /tmp/expo-test-export
npx expo export --platform ios --output-dir /tmp/expo-test-export 2>&1
