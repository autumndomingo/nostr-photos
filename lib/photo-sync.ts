import { toHex, type CID } from "@hashtree/core";
import {
  addFileToTree,
  getRootKeyHex,
  loadRootCID,
  rebuildPhotoRoot,
  stageFileInTree,
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
  replacePhotoEntries,
  type PhotoEntry,
} from "./storage";
import {
  publishMerkleRoot,
  type PublishMerkleRootResult,
} from "./nostr";

let photoIngestQueue: Promise<unknown> = Promise.resolve();

type PublishPhotoRootOptions = {
  rootCid?: CID | null;
  entryCount?: number;
};

export type IngestPhotoBytesOptions = {
  capturedAt?: number;
  sourceAssetId?: string;
  extension?: string;
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
    const addResult = await addFileToTree(privateKey, fileCid, size, fileName);

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
