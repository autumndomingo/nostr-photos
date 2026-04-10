import { File, Paths } from "expo-file-system/next";
import { cid, fromHex, toHex } from "@hashtree/core";
import { loadRootCID } from "./hashtree";
import { loadPrivateKey } from "./nostr";
import { flushPhotoRootToRemote } from "./photo-sync";
import { log } from "./logger";
import { loadPhotoEntries } from "./storage";
import { scheduleAfterInteractions } from "./cooperative";
import { clearDeferredText, readDeferredText, writeDeferredText } from "./deferred-file";

type PendingPhotoRemoteSyncJob = {
  rootHash: string;
  rootKey?: string;
  entryCount: number;
  updatedAt: number;
  reason?: string;
};
const REMOTE_SYNC_DEBOUNCE_MS = 1200;
const REMOTE_SYNC_RETRY_DELAY_MS = 6000;

let currentJob: PendingPhotoRemoteSyncJob | null = null;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
let runningPromise: Promise<void> | null = null;
let cancelScheduledRun: (() => void) | null = null;

function getPendingRemoteSyncFile(): File {
  return new File(Paths.document, "pending-photo-root-sync.json");
}

function readPendingRemoteSyncJob(): PendingPhotoRemoteSyncJob | null {
  try {
    const text = readDeferredText(getPendingRemoteSyncFile());
    if (!text) return null;
    const parsed = JSON.parse(text) as PendingPhotoRemoteSyncJob;
    if (
      !parsed ||
      typeof parsed.rootHash !== "string" ||
      typeof parsed.entryCount !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writePendingRemoteSyncJob(job: PendingPhotoRemoteSyncJob): void {
  writeDeferredText(getPendingRemoteSyncFile(), JSON.stringify(job));
}

function clearPendingRemoteSyncJob(): void {
  const file = getPendingRemoteSyncFile();
  clearDeferredText(file);
  if (file.exists) {
    file.delete();
  }
}

function snapshotPendingRemoteSyncJob(
  reason?: string
): PendingPhotoRemoteSyncJob | null {
  const rootCid = loadRootCID();
  if (!rootCid) {
    return null;
  }

  return {
    rootHash: toHex(rootCid.hash),
    rootKey: rootCid.key ? toHex(rootCid.key) : undefined,
    entryCount: loadPhotoEntries().length,
    updatedAt: Date.now(),
    reason,
  };
}

function schedulePendingRun(delayMs: number): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
  }
  cancelScheduledRun?.();
  cancelScheduledRun = null;

  scheduledTimer = setTimeout(() => {
    scheduledTimer = null;
    cancelScheduledRun = scheduleAfterInteractions(() => {
      void runPendingPhotoRemoteSync();
    });
  }, delayMs);
}

async function runPendingPhotoRemoteSync(): Promise<void> {
  if (runningPromise) {
    return await runningPromise;
  }

  const nextJob = currentJob || readPendingRemoteSyncJob();
  if (!nextJob) {
    return;
  }

  currentJob = nextJob;
  runningPromise = (async () => {
    const job = nextJob;
    const privateKey = await loadPrivateKey().catch(() => null);
    if (!privateKey) {
      log("[SYNC] Pending photo sync found, but no private key is available");
      schedulePendingRun(REMOTE_SYNC_RETRY_DELAY_MS);
      return;
    }

    log(
      `[SYNC] Flushing photo root ${job.rootHash.slice(0, 16)}...`,
      `entries=${job.entryCount}`,
      job.reason ? `reason=${job.reason}` : ""
    );

    const rootCid = cid(
      fromHex(job.rootHash),
      job.rootKey ? fromHex(job.rootKey) : undefined
    );
    const result = await flushPhotoRootToRemote(privateKey, {
      rootCid,
      entryCount: job.entryCount,
    });

    if (!result.remoteSynced) {
      log("[SYNC] Photo root flush failed; will retry later");
      schedulePendingRun(REMOTE_SYNC_RETRY_DELAY_MS);
      return;
    }

    if (result.publishResult?.success) {
      log(
        "[SYNC] Photo root confirmed on",
        result.publishResult.confirmedRelays.length,
        "relay(s)"
      );
    } else if (result.publishResult) {
      log(
        "[SYNC] Photo root publish pending retry:",
        `accepted=${result.publishResult.acceptedRelays.length}`,
        `confirmed=${result.publishResult.confirmedRelays.length}`,
        result.publishResult.reason || ""
      );
    } else {
      log("[SYNC] Photo root flushed without a publish result");
    }

    const latest = currentJob || readPendingRemoteSyncJob();
    if (latest && latest.rootHash !== job.rootHash) {
      schedulePendingRun(REMOTE_SYNC_DEBOUNCE_MS);
      return;
    }

    currentJob = null;
    clearPendingRemoteSyncJob();
  })()
    .catch((error: any) => {
      log("[SYNC] Photo root flush error:", error?.message || error);
      schedulePendingRun(REMOTE_SYNC_RETRY_DELAY_MS);
    })
    .finally(() => {
      runningPromise = null;
    });

  return await runningPromise;
}

export function queuePhotoRootRemoteSync(reason?: string): void {
  const job = snapshotPendingRemoteSyncJob(reason);
  if (!job) {
    return;
  }

  currentJob = job;
  writePendingRemoteSyncJob(job);
  schedulePendingRun(REMOTE_SYNC_DEBOUNCE_MS);
}

export async function resumePendingPhotoRootRemoteSync(): Promise<void> {
  const job = readPendingRemoteSyncJob();
  if (!job) {
    return;
  }

  currentJob = job;
  schedulePendingRun(0);
}
