import { Directory, File, Paths } from "expo-file-system/next";
import { loadPrivateKey } from "./nostr";
import { ingestPhotoBytes } from "./photo-sync";
import { queuePhotoRootRemoteSync } from "./photo-remote-sync";
import { log } from "./logger";
import { scheduleAfterInteractions, yieldToUI } from "./cooperative";
import { readDeferredText, writeDeferredText } from "./deferred-file";

type PendingCapturedPhotoJob = {
  uri: string;
  capturedAt: number;
  extension: string;
  createdAt: number;
};
const INGEST_DEBOUNCE_MS = 1500;
const INGEST_RETRY_DELAY_MS = 5000;

let jobQueue: PendingCapturedPhotoJob[] | null = null;
let runningPromise: Promise<void> | null = null;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
let cancelScheduledRun: (() => void) | null = null;

function getPendingCaptureDir(): Directory {
  return new Directory(Paths.document, "pending-captures");
}

function getPendingCaptureFile(): File {
  return new File(Paths.document, "pending-photo-ingest.json");
}

function ensurePendingCaptureDir(): void {
  const pendingCaptureDir = getPendingCaptureDir();
  if (!pendingCaptureDir.exists) {
    pendingCaptureDir.create({ intermediates: true });
  }
}

function readQueue(): PendingCapturedPhotoJob[] {
  if (jobQueue) {
    return [...jobQueue];
  }

  try {
    const text = readDeferredText(getPendingCaptureFile());
    if (!text) {
      jobQueue = [];
      return [];
    }
    const parsed = JSON.parse(text) as PendingCapturedPhotoJob[];
    jobQueue = Array.isArray(parsed)
      ? parsed.filter(
          (job) =>
            job &&
            typeof job.uri === "string" &&
            typeof job.capturedAt === "number" &&
            typeof job.extension === "string"
        )
      : [];
    return [...jobQueue];
  } catch {
    jobQueue = [];
    return [];
  }
}

function writeQueue(queue: PendingCapturedPhotoJob[]): void {
  jobQueue = [...queue];
  writeDeferredText(getPendingCaptureFile(), JSON.stringify(jobQueue));
}

function scheduleRun(delayMs: number): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
  }
  cancelScheduledRun?.();
  cancelScheduledRun = null;

  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    cancelScheduledRun = scheduleAfterInteractions(() => {
      void runPendingPhotoIngestQueue();
    });
  }, delayMs);
}

export function enqueueCapturedPhotoForIngest(
  sourceUri: string,
  capturedAt: number,
  extension = "jpg"
): string {
  ensurePendingCaptureDir();
  const fileName = `capture_${capturedAt}.${extension.replace(/^\./, "")}`;
  const dest = new File(getPendingCaptureDir(), fileName);
  if (dest.exists) {
    dest.delete();
  }

  const source = new File(sourceUri);
  source.move(dest);

  const queue = readQueue();
  queue.push({
    uri: dest.uri,
    capturedAt,
    extension: extension.replace(/^\./, "") || "jpg",
    createdAt: Date.now(),
  });
  writeQueue(queue);
  scheduleRun(INGEST_DEBOUNCE_MS);
  return dest.uri;
}

async function runPendingPhotoIngestQueue(): Promise<void> {
  if (runningPromise) {
    return await runningPromise;
  }

  const queue = readQueue();
  if (queue.length === 0) {
    return;
  }

  runningPromise = (async () => {
    const privateKey = await loadPrivateKey().catch(() => null);
    if (!privateKey) {
      log("[INGEST] Pending photo ingest found, but no private key is available");
      scheduleRun(INGEST_RETRY_DELAY_MS);
      return;
    }

    while (true) {
      const currentQueue = readQueue();
      const nextJob = currentQueue[0];
      if (!nextJob) {
        break;
      }

      try {
        const file = new File(nextJob.uri);
        if (!file.exists) {
          throw new Error("Pending capture file is missing");
        }

        const bytes = await file.bytes();
        const result = await ingestPhotoBytes(privateKey, bytes, {
          capturedAt: nextJob.capturedAt,
          extension: nextJob.extension,
          syncToBlossom: false,
          publishToNostr: false,
        });

        if (!result.duplicate) {
          queuePhotoRootRemoteSync("camera");
        }

        if (file.exists) {
          file.delete();
        }

        const remaining = currentQueue.slice(1);
        writeQueue(remaining);
      } catch (error: any) {
        log("[INGEST] Photo ingest failed:", error?.message || error);
        scheduleRun(INGEST_RETRY_DELAY_MS);
        return;
      }

      await yieldToUI(2);
    }
  })().finally(() => {
    runningPromise = null;
  });

  return await runningPromise;
}

export async function resumePendingPhotoIngest(): Promise<void> {
  if (readQueue().length === 0) {
    return;
  }

  scheduleRun(0);
}
