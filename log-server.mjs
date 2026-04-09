// Tiny log server — receives logs from the phone app and writes to /tmp/app-logs.txt
import { createServer } from "http";
import { appendFileSync, writeFileSync } from "fs";

const LOG_FILE = "/tmp/app-logs.txt";
writeFileSync(LOG_FILE, `--- Log server started ${new Date().toISOString()} ---\n`);

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const line = `[${new Date().toISOString()}] ${body}\n`;
      appendFileSync(LOG_FILE, line);
      process.stdout.write(line);
      res.writeHead(200);
      res.end("ok");
    });
  } else {
    res.writeHead(200);
    res.end("log server running");
  }
});

server.listen(9999, "0.0.0.0", () => {
  console.log("Log server on http://0.0.0.0:9999 → /tmp/app-logs.txt");
});
