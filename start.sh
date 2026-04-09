#!/usr/bin/env bash
set -e

# Kill any existing processes on our ports
kill $(lsof -t -i:4000) 2>/dev/null || true
kill $(lsof -t -i:5173) 2>/dev/null || true
kill $(lsof -t -i:5174) 2>/dev/null || true
kill $(lsof -t -i:5175) 2>/dev/null || true

sleep 1

# Check gh CLI authentication
if ! gh auth status &>/dev/null; then
  echo "Error: gh CLI not authenticated. Run: gh auth login"
  exit 1
fi
echo "gh CLI: authenticated as $(gh api /user -q .login)"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing server dependencies..."
  npm install
fi

if [ ! -d "client/node_modules" ]; then
  echo "Installing client dependencies..."
  cd client && npm install && cd ..
fi

# Start both server and client
echo "Starting Kanban MVP..."
npm run dev
