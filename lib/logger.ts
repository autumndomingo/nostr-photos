// Remote logger — sends logs to the log server on the Mac
// Falls back to console.log if server isn't reachable

const LOG_SERVER = "http://172.20.10.4:9999/log";
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
