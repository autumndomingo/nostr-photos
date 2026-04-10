#!/bin/sh

set -eu

LOG_SERVER_PID=""

cleanup() {
  if [ -n "$LOG_SERVER_PID" ]; then
    kill "$LOG_SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

node log-server.mjs &
LOG_SERVER_PID=$!

npx expo start "$@"
