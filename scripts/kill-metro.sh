#!/bin/bash
# Kill Metro and any process on port 8081
lsof -ti:8081 | xargs kill 2>/dev/null
echo "Metro stopped"
