#!/bin/sh

set -eu

if ! command -v adb >/dev/null 2>&1; then
  echo "adb not found on PATH. Run this inside a shell that provides Android platform-tools." >&2
  exit 1
fi

adb_cmd() {
  if [ -n "${ANDROID_SERIAL:-}" ]; then
    adb -s "$ANDROID_SERIAL" "$@"
  else
    adb "$@"
  fi
}

if [ -z "${ANDROID_SERIAL:-}" ]; then
  device_count="$(adb devices | awk 'NR > 1 && $2 == "device" { count += 1 } END { print count + 0 }')"
  if [ "$device_count" -eq 0 ]; then
    echo "No Android device detected by adb." >&2
    exit 1
  fi
  if [ "$device_count" -gt 1 ]; then
    echo "Multiple Android devices detected. Set ANDROID_SERIAL to choose one." >&2
    exit 1
  fi
fi

adb_cmd reverse tcp:8081 tcp:8081
adb_cmd reverse tcp:9999 tcp:9999

echo "adb reverse is configured for Metro on tcp:8081 and log server on tcp:9999"

exec sh ./scripts/start-with-log-server.sh --localhost --android "$@"
