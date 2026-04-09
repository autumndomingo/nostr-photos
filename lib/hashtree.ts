import {
  HashTree,
  MemoryStore,
  BlossomStore,
  FallbackStore,
  LinkType,
  toHex,
  type CID,
  type BlossomSigner,
} from "@hashtree/core";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "nostr-tools/utils";
import { File, Paths } from "expo-file-system/next";

const BLOSSOM_SERVERS = [
  { url: "https://blossom.primal.net", read: true, write: true },
  { url: "https://blossom.band", read: true, write: false },
];

const ROOT_FILE = new File(Paths.document, "tree-root.json");

// Create a Blossom signer from a Nostr private key
function createSigner(privateKey: Uint8Array): BlossomSigner {
  return async (draft) => {
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
  };
}

// Create a HashTree instance backed by Blossom
export function createHashTree(privateKey: Uint8Array): {
  tree: HashTree;
  blossomStore: BlossomStore;
} {
  const signer = createSigner(privateKey);

  const blossomStore = new BlossomStore({
    servers: BLOSSOM_SERVERS,
    signer,
  });

  const localStore = new MemoryStore();

  const store = new FallbackStore({
    primary: localStore,
    fallbacks: [blossomStore],
  });

  const tree = new HashTree({ store });

  return { tree, blossomStore };
}

// Save the root CID locally so we can reload the tree
export function saveRootCID(rootCid: CID): void {
  const data = {
    hash: toHex(rootCid.hash),
    key: rootCid.key ? toHex(rootCid.key) : undefined,
  };
  ROOT_FILE.write(JSON.stringify(data));
}

// Load the saved root CID
export function loadRootCID(): CID | null {
  if (!ROOT_FILE.exists) return null;
  try {
    const text = ROOT_FILE.textSync();
    const data = JSON.parse(text);
    if (!data.hash) return null;

    const { fromHex, cid } = require("@hashtree/core");
    return cid(fromHex(data.hash), data.key ? fromHex(data.key) : undefined);
  } catch {
    return null;
  }
}

// Add a photo to the tree, returns the new root CID
export async function addPhotoToTree(
  tree: HashTree,
  blossomStore: BlossomStore,
  photoData: Uint8Array,
  fileName: string,
  currentRoot: CID | null
): Promise<{ rootCid: CID; fileCid: CID }> {
  // Store the file (encrypted by default)
  const { cid: fileCid, size } = await tree.putFile(photoData);

  let rootCid: CID;

  if (currentRoot) {
    // Add to existing directory
    rootCid = await tree.setEntry(
      currentRoot,
      [],
      fileName,
      fileCid,
      size,
      LinkType.File
    );
  } else {
    // Create a new directory with this file
    const { cid: dirCid } = await tree.putDirectory([
      { name: fileName, cid: fileCid, size, type: LinkType.File },
    ]);
    rootCid = dirCid;
  }

  // Push all new chunks to Blossom
  await tree.push(rootCid, blossomStore, { concurrency: 4 });

  // Save root locally
  saveRootCID(rootCid);

  return { rootCid, fileCid };
}

// List all photos in the tree
export async function listPhotos(
  tree: HashTree,
  rootCid: CID
): Promise<Array<{ name: string; cid: CID; size: number }>> {
  const entries = await tree.listDirectory(rootCid);
  return entries
    .filter((e) => e.type === LinkType.File)
    .map((e) => ({ name: e.name, cid: e.cid, size: e.size }));
}

// Read a photo from the tree
export async function readPhoto(
  tree: HashTree,
  fileCid: CID
): Promise<Uint8Array | null> {
  return tree.readFile(fileCid);
}
