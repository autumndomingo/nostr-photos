import { toHex, type CID } from "@hashtree/core";
import { File } from "expo-file-system/next";
import {
  addFileToTree,
  getRootKeyHex,
  loadRootCID,
  rebuildPhotoRoot,
  stageFileInTree,
  syncRootToBlossom,
} from "./hashtree";
import { log } from "./logger";
import {
  addPhotoEntry,
  attachSourceAssetIdToPhotoEntry,
  buildSequentialPhotoFileName,
  entryToCid,
  extractFileExtension,
  getLocalCachePathForEntry,
  getNextPhotoSequence,
  hasLegacyPhotoNames,
  loadPhotoEntries,
  parsePhotoSequence,
  rememberPhotoDisplayUri,
  replacePhotoEntries,
  type PhotoEntry,
} from "./storage";
import {
  publishMerkleRoot,
  type PublishMerkleRootResult,
} from "./nostr";
import * as MediaLibrary from "expo-media-library";
import {
  isIrisWebCompatiblePhotoEntry,
  normalizePhotoUriForIris,
} from "./photo-compat";
import { yieldToUI } from "./cooperative";

let photoIngestQueue: Promise<unknown> = Promise.resolve();

type PublishPhotoRootOptions = {
  rootCid?: CID | null;
  entryCount?: number;
};

export type IngestPhotoBytesOptions = {
  capturedAt?: number;
  sourceAssetId?: string;
  extension?: string;
  syncToBlossom?: boolean;
  publishToNostr?: boolean;
};

export type IngestPhotoBytesResult = {
  duplicate: boolean;
  inserted: boolean;
  remoteSynced: boolean;
  fileCid: CID;
  entry: PhotoEntry;
  rootCid?: CID;
  publishResult?: PublishMerkleRootResult | null;
};

export type EnsureSequentialNamingResult = {
  changed: boolean;
  remoteSynced: boolean;
  publishResult?: PublishMerkleRootResult | null;
};

export type EnsureIrisCompatiblePhotoLibraryResult = {
  changed: boolean;
  repaired: number;
  failed: number;
  remoteSynced: boolean;
  publishResult?: PublishMerkleRootResult | null;
};

export type FlushPhotoRootResult = {
  remoteSynced: boolean;
  publishResult?: PublishMerkleRootResult | null;
};

function queuePhotoIngest<T>(task: () => Promise<T>): Promise<T> {
  const result = photoIngestQueue.catch(() => {}).then(task);
  photoIngestQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function sortChronologically(entries: PhotoEntry[]): PhotoEntry[] {
  return [...entries].sort((a, b) => {
    const capturedDiff =
      (a.capturedAt ?? a.timestamp) - (b.capturedAt ?? b.timestamp);
    if (capturedDiff !== 0) return capturedDiff;

    const sequenceDiff = (a.sequence || 0) - (b.sequence || 0);
    if (sequenceDiff !== 0) return sequenceDiff;

    return a.timestamp - b.timestamp;
  });
}

function writePhotoCache(entry: PhotoEntry, bytes: Uint8Array): void {
  const cacheFile = getLocalCachePathForEntry(entry);
  if (!cacheFile.exists) {
    cacheFile.write(bytes);
  }
  rememberPhotoDisplayUri(entry, cacheFile.uri);
}

async function resolveRepairPhotoUri(
  entry: PhotoEntry
): Promise<{ uri: string; fileName: string } | null> {
  const cachedFile = getLocalCachePathForEntry(entry);
  if (cachedFile.exists) {
    return {
      uri: cachedFile.uri,
      fileName: entry.name,
    };
  }

  if (!entry.sourceAssetId) {
    return null;
  }

  const assetInfo = await MediaLibrary.getAssetInfoAsync(entry.sourceAssetId, {
    shouldDownloadFromNetwork: true,
  });

  if (!assetInfo.localUri) {
    return null;
  }

  return {
    uri: assetInfo.localUri,
    fileName: assetInfo.filename || entry.name,
  };
}

export async function publishPhotoRoot(
  privateKey: Uint8Array,
  options?: PublishPhotoRootOptions
): Promise<PublishMerkleRootResult | null> {
  const rootCid = options?.rootCid || loadRootCID();
  if (!rootCid) {
    return null;
  }

  const entries = loadPhotoEntries();
  const entryCount = options?.entryCount ?? entries.length;
  const rootHash = toHex(rootCid.hash);
  const rootKeyHex = getRootKeyHex(rootCid);

  return await publishMerkleRoot(
    privateKey,
    rootHash,
    entryCount,
    rootKeyHex
  );
}

export async function flushPhotoRootToRemote(
  privateKey: Uint8Array,
  options?: PublishPhotoRootOptions
): Promise<FlushPhotoRootResult> {
  return await queuePhotoIngest(async () => {
    const rootCid = options?.rootCid || loadRootCID();
    if (!rootCid) {
      return {
        remoteSynced: true,
        publishResult: null,
      };
    }

    const remoteSynced = await syncRootToBlossom(privateKey, rootCid);
    if (!remoteSynced) {
      return {
        remoteSynced: false,
        publishResult: null,
      };
    }

    return {
      remoteSynced: true,
      publishResult: await publishPhotoRoot(privateKey, {
        rootCid,
        entryCount: options?.entryCount,
      }),
    };
  });
}

export async function ensureSequentialPhotoLibrary(
  privateKey: Uint8Array
): Promise<EnsureSequentialNamingResult> {
  return await queuePhotoIngest(async () => {
    const entries = loadPhotoEntries();
    if (entries.length === 0 || !hasLegacyPhotoNames(entries)) {
      return {
        changed: false,
        remoteSynced: true,
        publishResult: null,
      };
    }

    const chronologicalEntries = sortChronologically(entries);
    const renamedEntries = chronologicalEntries.map((entry, index) => {
      const sequence = index + 1;
      const extension = entry.cacheExtension || extractFileExtension(entry.name);
      return {
        ...entry,
        sequence,
        name: buildSequentialPhotoFileName(sequence, extension),
      };
    });

    replacePhotoEntries(renamedEntries);
    await yieldToUI();

    const rebuildResult = await rebuildPhotoRoot(
      privateKey,
      renamedEntries.map((entry) => ({
        name: entry.name,
        cid: entryToCid(entry),
        size: entry.size,
      }))
    );

    if (!rebuildResult) {
      return {
        changed: false,
        remoteSynced: true,
        publishResult: null,
      };
    }

    if (!rebuildResult.remoteSynced) {
      log("[PHOTO] Sequential naming migration updated local root but Blossom sync failed");
      return {
        changed: true,
        remoteSynced: false,
        publishResult: null,
      };
    }

    const publishResult = await publishPhotoRoot(privateKey, {
      rootCid: rebuildResult.rootCid,
      entryCount: renamedEntries.length,
    });

    return {
      changed: true,
      remoteSynced: true,
      publishResult,
    };
  });
}

export async function ensureIrisCompatiblePhotoLibrary(
  privateKey: Uint8Array
): Promise<EnsureIrisCompatiblePhotoLibraryResult> {
  return await queuePhotoIngest(async () => {
    const entries = loadPhotoEntries();
    const repairTargets = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !isIrisWebCompatiblePhotoEntry(entry));

    if (repairTargets.length === 0) {
      return {
        changed: false,
        repaired: 0,
        failed: 0,
        remoteSynced: true,
        publishResult: null,
      };
    }

    const repairedEntries = [...entries];
    let repaired = 0;
    let failed = 0;

    for (const { entry, index } of repairTargets) {
      try {
        const source = await resolveRepairPhotoUri(entry);
        if (!source) {
          throw new Error("No repair source is available for this photo.");
        }

        const normalized = await normalizePhotoUriForIris({
          uri: source.uri,
          fileName: source.fileName,
        });
        const bytes = await new File(normalized.uri).bytes();
        const { fileCid, size } = await stageFileInTree(privateKey, bytes);
        const previousCacheFile = getLocalCachePathForEntry(entry);
        const sequence = entry.sequence || parsePhotoSequence(entry.name) || index + 1;

        const nextEntry: PhotoEntry = {
          ...entry,
          name: buildSequentialPhotoFileName(sequence, normalized.extension),
          cidHash: toHex(fileCid.hash),
          cidKey: fileCid.key ? toHex(fileCid.key) : undefined,
          size,
          sequence,
          cacheExtension: normalized.extension,
        };

        repairedEntries[index] = nextEntry;
        writePhotoCache(nextEntry, bytes);

        const nextCacheFile = getLocalCachePathForEntry(nextEntry);
        if (previousCacheFile.exists && previousCacheFile.uri !== nextCacheFile.uri) {
          previousCacheFile.delete();
        }

        repaired += 1;
        log(`[PHOTO] Repaired ${entry.name} for Iris compatibility`);
      } catch (error: any) {
        failed += 1;
        log("[PHOTO] Repair failed", entry.name, error?.message || error);
      }

      await yieldToUI();
    }

    if (repaired === 0) {
      return {
        changed: false,
        repaired,
        failed,
        remoteSynced: true,
        publishResult: null,
      };
    }

    replacePhotoEntries(repairedEntries);
    await yieldToUI();

    const rebuildResult = await rebuildPhotoRoot(
      privateKey,
      repairedEntries.map((entry) => ({
        name: entry.name,
        cid: entryToCid(entry),
        size: entry.size,
      }))
    );

    if (!rebuildResult) {
      return {
        changed: false,
        repaired,
        failed,
        remoteSynced: true,
        publishResult: null,
      };
    }

    if (!rebuildResult.remoteSynced) {
      log("[PHOTO] Iris compatibility repair updated local root but Blossom sync failed");
      return {
        changed: true,
        repaired,
        failed,
        remoteSynced: false,
        publishResult: null,
      };
    }

    const publishResult = await publishPhotoRoot(privateKey, {
      rootCid: rebuildResult.rootCid,
      entryCount: repairedEntries.length,
    });

    return {
      changed: true,
      repaired,
      failed,
      remoteSynced: true,
      publishResult,
    };
  });
}

export async function ingestPhotoBytes(
  privateKey: Uint8Array,
  bytes: Uint8Array,
  options: IngestPhotoBytesOptions = {}
): Promise<IngestPhotoBytesResult> {
  return await queuePhotoIngest(async () => {
    const existingEntries = loadPhotoEntries();
    const { fileCid, size } = await stageFileInTree(privateKey, bytes);
    const cidHash = toHex(fileCid.hash);
    const existingEntry = existingEntries.find((entry) => entry.cidHash === cidHash);

    if (existingEntry) {
      if (options.sourceAssetId) {
        attachSourceAssetIdToPhotoEntry(cidHash, options.sourceAssetId);
      }
      writePhotoCache(existingEntry, bytes);
      return {
        duplicate: true,
        inserted: false,
        remoteSynced: true,
        fileCid,
        entry: existingEntry,
        publishResult: null,
      };
    }

    const extension = extractFileExtension(options.extension || "photo.jpg");
    const sequence = getNextPhotoSequence(existingEntries);
    const fileName = buildSequentialPhotoFileName(sequence, extension);
    const addResult = await addFileToTree(privateKey, fileCid, size, fileName, {
      syncToBlossom: options.syncToBlossom,
    });

    const entry = addPhotoEntry(fileName, fileCid, size, {
      capturedAt: options.capturedAt,
      sequence,
      sourceAssetId: options.sourceAssetId,
      cacheExtension: extension,
    });

    writePhotoCache(entry, bytes);

    let publishResult: PublishMerkleRootResult | null = null;
    if (options.publishToNostr !== false && addResult.remoteSynced) {
      publishResult = await publishPhotoRoot(privateKey, {
        rootCid: addResult.rootCid,
        entryCount: loadPhotoEntries().length,
      });
    }

    return {
      duplicate: false,
      inserted: true,
      remoteSynced: addResult.remoteSynced,
      fileCid,
      entry,
      rootCid: addResult.rootCid,
      publishResult,
    };
  });
}
