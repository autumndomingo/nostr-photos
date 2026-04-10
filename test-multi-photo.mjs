/**
 * Test: simulate taking 2 photos and verify both exist in the tree.
 * This reproduces the exact flow from camera.tsx.
 */
import {
  HashTree, MemoryStore, BlossomStore, FallbackStore,
  toHex, fromHex, cid, LinkType
} from "@hashtree/core";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";

const sk = generateSecretKey();
const signer = async (draft) => finalizeEvent({
  kind: draft.kind, created_at: draft.created_at,
  content: draft.content, tags: draft.tags
}, sk);

const SERVERS = [
  { url: "https://upload.iris.to", read: true, write: true },
  { url: "https://cdn.iris.to", read: true, write: false },
  { url: "https://blossom.primal.net", read: true, write: true },
];

// Simulate what the app does: create fresh tree + store each time
function createHashTree() {
  const blossomStore = new BlossomStore({ servers: SERVERS, signer });
  const localStore = new MemoryStore();
  const store = new FallbackStore({ primary: localStore, fallbacks: [blossomStore] });
  const tree = new HashTree({ store });
  return { tree, blossomStore };
}

// Simulate saveRootCID / loadRootCID
let savedRoot = null;
function saveRoot(rootCid) {
  savedRoot = {
    hash: toHex(rootCid.hash),
    key: rootCid.key ? toHex(rootCid.key) : undefined,
  };
  console.log("  Saved root:", savedRoot.hash.slice(0, 16) + "...", "key:", savedRoot.key ? savedRoot.key.slice(0, 16) + "..." : "none");
}
function loadRoot() {
  if (!savedRoot) return null;
  return cid(fromHex(savedRoot.hash), savedRoot.key ? fromHex(savedRoot.key) : undefined);
}

// Simulate addPhotoToTree
async function addPhoto(photoData, fileName) {
  const { tree, blossomStore } = createHashTree();
  const currentRoot = loadRoot();

  console.log("  Current root:", currentRoot ? toHex(currentRoot.hash).slice(0, 16) + "..." : "none");

  const { cid: fileCid, size } = await tree.putFile(photoData);
  console.log("  File CID:", toHex(fileCid.hash).slice(0, 16) + "...");

  let rootCid;
  if (currentRoot) {
    console.log("  Adding to existing directory via setEntry...");
    try {
      rootCid = await tree.setEntry(currentRoot, [], fileName, fileCid, size, LinkType.File);
      console.log("  setEntry succeeded");
    } catch (e) {
      console.log("  setEntry FAILED:", e.message);
      console.log("  Falling back to new directory with just this photo");
      const { cid: dirCid } = await tree.putDirectory([
        { name: fileName, cid: fileCid, size, type: LinkType.File },
      ]);
      rootCid = dirCid;
    }
  } else {
    console.log("  Creating new directory (first photo)...");
    const { cid: dirCid } = await tree.putDirectory([
      { name: fileName, cid: fileCid, size, type: LinkType.File },
    ]);
    rootCid = dirCid;
  }

  // Push to Blossom
  console.log("  Pushing to Blossom...");
  const result = await tree.push(rootCid, blossomStore, { concurrency: 4 });
  console.log(`  Push: ${result.pushed} pushed, ${result.skipped} skipped, ${result.failed} failed`);
  if (result.errors.length > 0) {
    console.log("  Errors:", result.errors.map(e => e.error.message));
  }

  saveRoot(rootCid);
  return rootCid;
}

// Verify: read the tree from Blossom only (simulating iris-files)
async function verifyFromBlossom(rootCid) {
  const blossomStore = new BlossomStore({ servers: SERVERS, signer });
  const remoteTree = new HashTree({ store: blossomStore });

  console.log("\n  Verifying from Blossom (root:", toHex(rootCid.hash).slice(0, 16) + "...)");
  try {
    const entries = await remoteTree.listDirectory(rootCid);
    console.log(`  Found ${entries.length} entries:`);
    for (const entry of entries) {
      console.log(`    - ${entry.name} (${entry.size} bytes)`);
      // Try to read each file
      const data = await remoteTree.readFile(entry.cid);
      console.log(`      Read: ${data ? data.length + " bytes OK" : "FAILED"}`);
    }
    return entries.length;
  } catch (e) {
    console.log("  Verify FAILED:", e.message);
    return 0;
  }
}

// Run the test
console.log("=== Photo 1 ===");
const photo1 = new TextEncoder().encode("Photo 1 data: " + Date.now());
const root1 = await addPhoto(photo1, "photo_1.jpg");
const count1 = await verifyFromBlossom(root1);

console.log("\n=== Photo 2 ===");
const photo2 = new TextEncoder().encode("Photo 2 data: " + Date.now());
const root2 = await addPhoto(photo2, "photo_2.jpg");
const count2 = await verifyFromBlossom(root2);

console.log("\n=== Results ===");
console.log("After photo 1:", count1, "entries");
console.log("After photo 2:", count2, "entries");
if (count2 === 2) {
  console.log("✅ PASS — Both photos preserved in tree");
} else {
  console.log("❌ FAIL — Expected 2 entries, got", count2);
}
