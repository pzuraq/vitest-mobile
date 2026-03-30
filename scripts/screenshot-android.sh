#!/bin/bash
# Take a screenshot of the Android emulator and save to /tmp/android-screenshot.png
adb shell screencap -p /sdcard/screenshot.png 2>/dev/null \
  && adb pull /sdcard/screenshot.png /tmp/android-screenshot.png 2>/dev/null \
  && echo "Screenshot saved to /tmp/android-screenshot.png" \
  || echo "Screenshot failed — is the emulator running?"
