#!/bin/bash
# Read the last N lines of Metro output (default 50)
LINES=${1:-50}
tail -n "$LINES" /tmp/metro-output.log 2>/dev/null || echo "No Metro log found. Start Metro first with ./scripts/start-metro.sh"
