// Remote logger — sends logs to the log server on the Mac
// Falls back to console.log if server isn't reachable

const LOG_SERVER = "http://172.20.10.4:9999/log";

export function log(...args: any[]) {
  const message = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
  console.log(message);

  // Fire and forget — don't await, don't block
  fetch(LOG_SERVER, {
    method: "POST",
    body: message,
  }).catch(() => {});
}
