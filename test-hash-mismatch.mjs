/**
 * Reproduce the hash mismatch bug:
 * 1. Upload photo 1 → new directory → push to Blossom → save root
 * 2. Upload photo 2 → create fresh tree (like the phone does) → try setEntry → read old root from Blossom
 * 3. Check if old root data matches the hash
 *
 * This exactly simulates the phone's flow where each photo creates a new MemoryStore.
 */
import {
  HashTree, MemoryStore, BlossomStore, FallbackStore,
  toHex, fromHex, cid, LinkType, sha256
} from "@hashtree/core";
import { generateSecretKey, finalizeEvent } from "nostr-tools/pure";

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

console.log("=== Photo 1: Create initial tree ===");
const blossom1 = new BlossomStore({ servers: SERVERS, signer,
  logger: (e) => { if (!e.success || e.operation !== 'has') console.log(`  [B] ${e.operation} ${e.hash?.slice(0,12)}... ${e.server.split('//')[1]} ${e.success ? 'OK' : 'FAIL'} ${e.error || ''} ${e.bytes ? e.bytes+'b' : ''}`); }
});
const mem1 = new MemoryStore();
const store1 = new FallbackStore({ primary: mem1, fallbacks: [blossom1] });
const tree1 = new HashTree({ store: store1 });

const photo1 = new Uint8Array(1000);
crypto.getRandomValues(photo1);
const { cid: file1, size: size1 } = await tree1.putFile(photo1);
const { cid: root1 } = await tree1.putDirectory([
  { name: "photo_1.jpg", cid: file1, size: size1, type: LinkType.File }
]);

console.log("Root1 hash:", toHex(root1.hash).slice(0, 16) + "...");
console.log("Root1 key:", root1.key ? toHex(root1.key).slice(0, 16) + "..." : "none");

// Push to Blossom
const push1 = await tree1.push(root1, blossom1, { concurrency: 2 });
console.log(`Push1: ${push1.pushed} pushed, ${push1.failed} failed`);

// Now manually verify we can read root1 back from Blossom
console.log("\n=== Verify: Read root1 from Blossom ===");
const rawData = await blossom1.get(root1.hash);
if (rawData) {
  const serverHash = toHex(await sha256(rawData));
  const expectedHash = toHex(root1.hash);
  console.log("Expected hash:", expectedHash.slice(0, 16) + "...");
  console.log("Server hash:  ", serverHash.slice(0, 16) + "...");
  console.log("Match:", serverHash === expectedHash);
  if (serverHash !== expectedHash) {
    console.log("❌ HASH MISMATCH — this is the bug!");
    console.log("Raw data length:", rawData.length);
  }
} else {
  console.log("❌ Could not read root1 from Blossom at all");
}

// Simulate phone: create fresh tree, load old root, try setEntry
console.log("\n=== Photo 2: Fresh tree, try to add to existing ===");
const blossom2 = new BlossomStore({ servers: SERVERS, signer,
  logger: (e) => { if (!e.success || e.operation !== 'has') console.log(`  [B] ${e.operation} ${e.hash?.slice(0,12)}... ${e.server.split('//')[1]} ${e.success ? 'OK' : 'FAIL'} ${e.error || ''} ${e.bytes ? e.bytes+'b' : ''}`); }
});
const mem2 = new MemoryStore();
const store2 = new FallbackStore({ primary: mem2, fallbacks: [blossom2] });
const tree2 = new HashTree({ store: store2 });

const photo2 = new Uint8Array(1000);
crypto.getRandomValues(photo2);
const { cid: file2, size: size2 } = await tree2.putFile(photo2);

// Reconstruct root1 CID (simulating loadRootCID)
const savedRoot = cid(root1.hash, root1.key);
console.log("Loaded root CID, attempting setEntry...");

try {
  const root2 = await tree2.setEntry(savedRoot, [], "photo_2.jpg", file2, size2, LinkType.File);
  console.log("setEntry succeeded! New root:", toHex(root2.hash).slice(0, 16) + "...");

  // Verify both entries
  const entries = await tree2.listDirectory(root2);
  console.log("Directory has", entries.length, "entries:");
  entries.forEach(e => console.log("  -", e.name));

  if (entries.length === 2) {
    console.log("\n✅ PASS — Both photos in tree");
  } else {
    console.log("\n❌ FAIL — Expected 2 entries, got", entries.length);
  }
} catch (e) {
  console.log("setEntry FAILED:", e.message);
  console.log("❌ FAIL — This is what happens on the phone");
}
