#!/bin/bash
# Take a screenshot of the simulator and save to /tmp/sim-screenshot.png
xcrun simctl io booted screenshot /tmp/sim-screenshot.png --type=png 2>/dev/null
echo "Screenshot saved to /tmp/sim-screenshot.png"
