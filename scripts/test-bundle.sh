#!/bin/bash
# Quick check: does the Metro bundle compile?
cd "$(dirname "$0")/../app"
rm -rf /tmp/expo-test-export
npx expo export --platform ios --output-dir /tmp/expo-test-export 2>&1
