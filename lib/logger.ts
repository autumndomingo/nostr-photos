// Remote logger — sends logs to the dev machine's log server when available.
// Falls back to console.log if the server isn't reachable.

import Constants from "expo-constants";

function resolveLogServer() {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.platform?.hostUri;

  if (hostUri) {
    try {
      const url = new URL(`http://${hostUri}`);
      return `http://${url.hostname}:9999/log`;
    } catch {
      // Ignore malformed development host strings and fall back below.
    }
  }

  return "http://localhost:9999/log";
}

const LOG_SERVER = resolveLogServer();
const LOG_FLUSH_INTERVAL_MS = 250;
const MAX_QUEUED_LOGS = 200;

let pendingMessages: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (pendingMessages.length === 0) return;

    const payload = pendingMessages.join("\n");
    pendingMessages = [];

    fetch(LOG_SERVER, {
      method: "POST",
      body: payload,
    }).catch(() => {});
  }, LOG_FLUSH_INTERVAL_MS);
}

export function log(...args: any[]) {
  const message = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  console.log(message);

  if (pendingMessages.length >= MAX_QUEUED_LOGS) {
    pendingMessages.shift();
  }
  pendingMessages.push(message);
  scheduleFlush();
}
