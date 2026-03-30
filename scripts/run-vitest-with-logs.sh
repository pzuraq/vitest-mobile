#!/bin/bash
# Run vitest, then capture screenshot + metro logs for debugging.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

lsof -ti:7878 | xargs kill 2>/dev/null
lsof -ti:8081 | xargs kill 2>/dev/null
sleep 1

cd "$SCRIPT_DIR/.."
timeout 120 npx vitest run --reporter=verbose 2>&1 | tee /tmp/vitest-output.log
EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "=== Vitest exit code: $EXIT_CODE ==="
echo ""
echo "=== Screenshot ==="
"$SCRIPT_DIR/screenshot.sh" 2>/dev/null

echo ""
echo "=== Metro logs (last 40) ==="
"$SCRIPT_DIR/metro-logs.sh" 40 2>/dev/null

# Cleanup
lsof -ti:7878 | xargs kill 2>/dev/null
lsof -ti:8081 | xargs kill 2>/dev/null
