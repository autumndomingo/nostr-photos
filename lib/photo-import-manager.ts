import { File, Paths } from "expo-file-system/next";
import { loadPrivateKey } from "./nostr";
import { ensureSequentialPhotoLibrary } from "./photo-sync";
import {
  importPhotoLibrary,
  importSelectedPhotoAssets,
  pickSelectedPhotosForImport,
  type ImportLibraryProgress,
  type ImportLibraryResult,
  type SelectedPhotoImportAsset,
} from "./photo-library-import";
import { log } from "./logger";
import { clearDeferredText, readDeferredText, writeDeferredText } from "./deferred-file";

type PendingImportJob =
  | {
      kind: "all";
      createdAt: number;
    }
  | {
      kind: "selected";
      createdAt: number;
      assets: SelectedPhotoImportAsset[];
    };

export type PhotoImportManagerSnapshot = {
  active: boolean;
  progress: ImportLibraryProgress | null;
  result: ImportLibraryResult | null;
  pendingJob: PendingImportJob | null;
};

let currentSnapshot: PhotoImportManagerSnapshot = {
  active: false,
  progress: null,
  result: null,
  pendingJob: null,
};

let currentJobPromise: Promise<ImportLibraryResult | null> | null = null;
const listeners = new Set<(snapshot: PhotoImportManagerSnapshot) => void>();

function getPendingImportFile(): File {
  return new File(Paths.document, "pending-photo-import.json");
}

function emitSnapshot(next: Partial<PhotoImportManagerSnapshot>): void {
  currentSnapshot = {
    ...currentSnapshot,
    ...next,
  };

  for (const listener of listeners) {
    listener(currentSnapshot);
  }
}

function readPendingImportJob(): PendingImportJob | null {
  try {
    const text = readDeferredText(getPendingImportFile());
    if (!text) return null;
    const parsed = JSON.parse(text) as PendingImportJob;
    if (!parsed || (parsed.kind !== "all" && parsed.kind !== "selected")) {
      return null;
    }
    if (parsed.kind === "selected" && !Array.isArray(parsed.assets)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePendingImportJob(job: PendingImportJob): void {
  writeDeferredText(getPendingImportFile(), JSON.stringify(job));
}

function clearPendingImportJob(): void {
  const file = getPendingImportFile();
  clearDeferredText(file);
  if (file.exists) {
    file.delete();
  }
}

async function runPendingImportJob(job: PendingImportJob): Promise<ImportLibraryResult> {
  const privateKey = await loadPrivateKey();
  if (!privateKey) {
    return {
      status: "failed",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      reason: "No account is available for photo import.",
    };
  }

  await ensureSequentialPhotoLibrary(privateKey);

  if (job.kind === "all") {
    return await importPhotoLibrary(privateKey, {
      mode: "all",
      onProgress: (progress) => {
        emitSnapshot({ active: true, progress, pendingJob: job, result: null });
      },
    });
  }

  return await importSelectedPhotoAssets(privateKey, job.assets, (progress) => {
    emitSnapshot({ active: true, progress, pendingJob: job, result: null });
  });
}

async function startJob(job: PendingImportJob): Promise<ImportLibraryResult | null> {
  if (currentJobPromise) {
    return await currentJobPromise;
  }

  writePendingImportJob(job);
  emitSnapshot({
    active: true,
    progress: currentSnapshot.progress,
    pendingJob: job,
    result: null,
  });

  currentJobPromise = (async () => {
    try {
      const result = await runPendingImportJob(job);
      const shouldClearPending =
        result.status === "completed" ||
        result.status === "cancelled" ||
        result.status === "denied" ||
        result.status === "unsupported";

      if (shouldClearPending) {
        clearPendingImportJob();
        emitSnapshot({
          active: false,
          pendingJob: null,
          result,
        });
      } else {
        emitSnapshot({
          active: false,
          pendingJob: job,
          result,
        });
      }

      return result;
    } catch (error: any) {
      const failure: ImportLibraryResult = {
        status: "failed",
        total: currentSnapshot.progress?.total || 0,
        processed: currentSnapshot.progress?.processed || 0,
        imported: currentSnapshot.progress?.imported || 0,
        skipped: currentSnapshot.progress?.skipped || 0,
        failed: (currentSnapshot.progress?.failed || 0) + 1,
        reason: error?.message || "Photo import failed.",
      };
      log("[IMPORT] Manager failed:", failure.reason);
      emitSnapshot({
        active: false,
        pendingJob: job,
        progress: currentSnapshot.progress
          ? {
              ...currentSnapshot.progress,
              phase: "error",
              message: failure.reason,
            }
          : null,
        result: failure,
      });
      return failure;
    } finally {
      currentJobPromise = null;
    }
  })();

  return await currentJobPromise;
}

export function subscribeToPhotoImport(
  listener: (snapshot: PhotoImportManagerSnapshot) => void
): () => void {
  listeners.add(listener);
  listener(currentSnapshot);

  return () => {
    listeners.delete(listener);
  };
}

export function getPhotoImportSnapshot(): PhotoImportManagerSnapshot {
  if (!currentSnapshot.pendingJob) {
    const pendingJob = readPendingImportJob();
    if (pendingJob) {
      currentSnapshot = {
        ...currentSnapshot,
        pendingJob,
      };
    }
  }
  return currentSnapshot;
}

export async function startAllPhotosImportJob(): Promise<ImportLibraryResult | null> {
  emitSnapshot({
    active: true,
    progress: {
      phase: "checking-permissions",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
    },
    result: null,
  });

  return await startJob({
    kind: "all",
    createdAt: Date.now(),
  });
}

export async function startSelectedPhotosImportJob(): Promise<ImportLibraryResult | null> {
  emitSnapshot({
    active: false,
    progress: {
      phase: "selecting",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      message: "Choose photos, then tap Done.",
    },
    result: null,
  });

  const selectedAssets = await pickSelectedPhotosForImport((progress) => {
    emitSnapshot({
      active: false,
      progress,
      result: null,
    });
  });

  if (!selectedAssets || selectedAssets.length === 0) {
    const cancelled: ImportLibraryResult = {
      status: "cancelled",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
    };
    emitSnapshot({
      active: false,
      progress: {
        phase: "cancelled",
        total: 0,
        processed: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
      },
      result: cancelled,
    });
    return cancelled;
  }

  emitSnapshot({
    active: true,
    progress: {
      phase: "loading",
      total: selectedAssets.length,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      message: "Preparing selected photos…",
    },
    result: null,
  });

  return await startJob({
    kind: "selected",
    createdAt: Date.now(),
    assets: selectedAssets,
  });
}

export async function resumePendingPhotoImport(): Promise<ImportLibraryResult | null> {
  if (currentJobPromise) {
    return await currentJobPromise;
  }

  const pendingJob = readPendingImportJob();
  if (!pendingJob) {
    return null;
  }

  emitSnapshot({
    active: true,
    progress: {
      phase: "loading",
      total: pendingJob.kind === "selected" ? pendingJob.assets.length : 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      message: "Resuming photo import…",
    },
    pendingJob,
    result: null,
  });

  return await startJob(pendingJob);
}
