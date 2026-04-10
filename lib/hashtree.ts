/**
 * HashTree integration — singleton pattern like iris-files.
 *
 * Key insight from iris: the tree and local store persist across operations.
 * When adding a new photo, setEntry reads the old directory from the LOCAL
 * store (not Blossom), so it always works. Blossom is only used for pushing
 * data out and for other clients to read.
 */
import {
  HashTree,
  BlossomStore,
  FallbackStore,
  LinkType,
  toHex,
  fromHex,
  cid,
  type CID,
  type BlossomSigner,
} from "@hashtree/core";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { File, Paths } from "expo-file-system/next";
import { FileStore } from "./file-store";
import { log } from "./logger";
import { readDeferredText, writeDeferredText } from "./deferred-file";

const BLOSSOM_SERVERS = [
  { url: "https://upload.iris.to", read: true, write: true },
  { url: "https://cdn.iris.to", read: true, write: false },
  { url: "https://blossom.primal.net", read: true, write: true },
];

function getRootFile(): File {
  return new File(Paths.document, "tree-root.json");
}

// ---- Singleton state ----
let _fileStore: FileStore | null = null;
let _blossomStore: BlossomStore | null = null;
let _tree: HashTree | null = null;
let _currentPrivateKey: Uint8Array | null = null;
let _cachedRootCid: CID | null = null;
let treeMutationQueue: Promise<unknown> = Promise.resolve();
const BLOSSOM_PUSH_CONCURRENCY = 6;

function createSigner(privateKey: Uint8Array): BlossomSigner {
  return async (draft) => {
    try {
      const event = finalizeEvent(
        {
          kind: draft.kind,
          created_at: draft.created_at,
          content: draft.content,
          tags: draft.tags,
        },
        privateKey
      );
      return event as any;
    } catch (e: any) {
      log("[SIGNER] FAILED:", e?.message);
      throw e;
    }
  };
}

/**
 * Get or create the singleton HashTree instance.
 * The FileStore persists all tree data locally, so setEntry
 * can always read previous directories without hitting Blossom.
 */
export function getHashTree(privateKey: Uint8Array): {
  tree: HashTree;
  blossomStore: BlossomStore;
} {
  // Reinitialize if key changed
  const keyHex = toHex(privateKey);
  const currentKeyHex = _currentPrivateKey ? toHex(_currentPrivateKey) : null;

  if (_tree && _blossomStore && keyHex === currentKeyHex) {
    return { tree: _tree, blossomStore: _blossomStore };
  }

  _currentPrivateKey = privateKey;
  _fileStore = new FileStore();

  _blossomStore = new BlossomStore({
    servers: BLOSSOM_SERVERS,
    signer: createSigner(privateKey),
    logger: (entry) => {
      const expectedReadMiss =
        (entry.operation === "get" &&
          (entry.error === "404" || entry.error === "Hash mismatch")) ||
        (entry.operation === "has" && entry.error === "404");
      if (expectedReadMiss) {
        return;
      }

      if (!entry.success) {
        const serverLabel = entry.server.includes("//")
          ? entry.server.split("//")[1]
          : entry.server;
        const bytesLabel =
          typeof entry.bytes === "number" ? `${entry.bytes}b` : "";
        log(
          `[BLOSSOM] ${entry.operation} ${entry.hash?.slice(0, 12)}... ${serverLabel} ${entry.success ? "OK" : "FAIL"} ${entry.error || ""} ${bytesLabel}`
        );
      }
    },
  });

  // FallbackStore: local FileStore is primary (always has tree data),
  // Blossom is fallback for data we don't have locally yet
  const store = new FallbackStore({
    primary: _fileStore,
    fallbacks: [_blossomStore],
  });

  _tree = new HashTree({ store });

  return { tree: _tree, blossomStore: _blossomStore };
}

function queueTreeMutation<T>(task: () => Promise<T>): Promise<T> {
  const result = treeMutationQueue.catch(() => {}).then(task);
  treeMutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

// Save the root CID locally
export function saveRootCID(rootCid: CID): void {
  const data = {
    hash: toHex(rootCid.hash),
    key: rootCid.key ? toHex(rootCid.key) : undefined,
  };
  _cachedRootCid = rootCid;
  writeDeferredText(getRootFile(), JSON.stringify(data));
}

// Load the saved root CID
export function loadRootCID(): CID | null {
  if (_cachedRootCid) {
    return _cachedRootCid;
  }
  try {
    const text = readDeferredText(getRootFile());
    if (!text) return null;
    const data = JSON.parse(text);
    if (!data.hash) return null;
    _cachedRootCid = cid(fromHex(data.hash), data.key ? fromHex(data.key) : undefined);
    return _cachedRootCid;
  } catch {
    return null;
  }
}

async function pushRootToBlossom(
  tree: HashTree,
  blossomStore: BlossomStore,
  rootCid: CID
): Promise<boolean> {
  const pushResult = await tree.push(rootCid, blossomStore, {
    concurrency: BLOSSOM_PUSH_CONCURRENCY,
    onBlock: (hash, status, error) => {
      if (status === "error") {
        log(`[PUSH] ${toHex(hash).slice(0, 12)}... ${status}: ${error?.message}`);
      }
    },
  });

  log(
    `[PUSH] Done: pushed=${pushResult.pushed} skipped=${pushResult.skipped} failed=${pushResult.failed}`
  );

  return pushResult.failed === 0 && !pushResult.cancelled;
}

export async function stageFileInTree(
  privateKey: Uint8Array,
  fileData: Uint8Array
): Promise<{ fileCid: CID; size: number }> {
  const { tree } = getHashTree(privateKey);
  const { cid: fileCid, size } = await tree.putFile(fileData);
  return { fileCid, size };
}

export async function addFileToTree(
  privateKey: Uint8Array,
  fileCid: CID,
  size: number,
  fileName: string,
  options?: {
    syncToBlossom?: boolean;
  }
): Promise<{ rootCid: CID; remoteSynced: boolean }> {
  return queueTreeMutation(async () => {
    const { tree, blossomStore } = getHashTree(privateKey);
    const currentRoot = loadRootCID();
    const shouldSyncToBlossom = options?.syncToBlossom !== false;

    let rootCid: CID;

    if (currentRoot) {
      rootCid = await tree.setEntry(
        currentRoot,
        [],
        fileName,
        fileCid,
        size,
        LinkType.File
      );
    } else {
      const { cid: dirCid } = await tree.putDirectory([
        { name: fileName, cid: fileCid, size, type: LinkType.File },
      ]);
      rootCid = dirCid;
    }

    saveRootCID(rootCid);

    return {
      rootCid,
      remoteSynced: shouldSyncToBlossom
        ? await pushRootToBlossom(tree, blossomStore, rootCid)
        : false,
    };
  });
}

export async function syncRootToBlossom(
  privateKey: Uint8Array,
  rootCid?: CID | null
): Promise<boolean> {
  const targetRoot = rootCid || loadRootCID();
  if (!targetRoot) {
    return true;
  }

  return await queueTreeMutation(async () => {
    const { tree, blossomStore } = getHashTree(privateKey);
    return await pushRootToBlossom(tree, blossomStore, targetRoot);
  });
}

export async function rebuildPhotoRoot(
  privateKey: Uint8Array,
  files: Array<{ name: string; cid: CID; size: number }>
): Promise<{ rootCid: CID; remoteSynced: boolean } | null> {
  if (files.length === 0) return null;

  return queueTreeMutation(async () => {
    const { tree, blossomStore } = getHashTree(privateKey);
    const { cid: rootCid } = await tree.putDirectory(
      files.map((file) => ({
        name: file.name,
        cid: file.cid,
        size: file.size,
        type: LinkType.File,
      }))
    );

    saveRootCID(rootCid);

    return {
      rootCid,
      remoteSynced: await pushRootToBlossom(tree, blossomStore, rootCid),
    };
  });
}

/**
 * Add a photo to the tree.
 * Because FileStore persists locally, setEntry can always read the
 * previous directory — no Blossom fetch needed for tree operations.
 * Push to Blossom happens after the tree is updated.
 */
export async function addPhotoToTree(
  privateKey: Uint8Array,
  photoData: Uint8Array,
  fileName: string
): Promise<{ rootCid: CID; fileCid: CID; remoteSynced: boolean }> {
  const { fileCid, size } = await stageFileInTree(privateKey, photoData);
  const { rootCid, remoteSynced } = await addFileToTree(
    privateKey,
    fileCid,
    size,
    fileName
  );

  return {
    rootCid,
    fileCid,
    remoteSynced,
  };
}

// Get the root CID key hex for publishing in Nostr events
export function getRootKeyHex(rootCid: CID): string | undefined {
  if (!rootCid.key) return undefined;
  return toHex(rootCid.key);
}

// List all photos in the tree
export async function listPhotos(
  privateKey: Uint8Array,
  rootCid: CID
): Promise<Array<{ name: string; cid: CID; size: number }>> {
  const { tree } = getHashTree(privateKey);
  const entries = await tree.listDirectory(rootCid);
  return entries
    .filter((e) => e.type === LinkType.File)
    .map((e) => ({ name: e.name, cid: e.cid, size: e.size }));
}
