#!/bin/bash
# Run vitest end-to-end. The pool manages Metro + app launch.
# Kill any leftover processes first.
lsof -ti:7878 | xargs kill 2>/dev/null
lsof -ti:8081 | xargs kill 2>/dev/null
sleep 1

cd "$(dirname "$0")/.."
timeout 120 npx vitest run --reporter=verbose 2>&1
EXIT_CODE=$?

echo ""
echo "=== Exit code: $EXIT_CODE ==="

# Cleanup
lsof -ti:7878 | xargs kill 2>/dev/null
lsof -ti:8081 | xargs kill 2>/dev/null
