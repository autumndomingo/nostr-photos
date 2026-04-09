/**
 * Test script: verifies HashTree + Blossom integration end-to-end
 * Run with: node test-hashtree.mjs
 */

import { HashTree, MemoryStore, BlossomStore, FallbackStore, toHex, LinkType } from "@hashtree/core";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { npubEncode } from "nostr-tools/nip19";

// Step 1: Generate a test keypair
console.log("=== Step 1: Generate test identity ===");
const privateKey = generateSecretKey();
const pubkeyHex = getPublicKey(privateKey);
const npub = npubEncode(pubkeyHex);
console.log("npub:", npub);
console.log("pubkey hex:", pubkeyHex);

// Step 2: Create signer
function createSigner(sk) {
  return async (draft) => {
    return finalizeEvent({
      kind: draft.kind,
      created_at: draft.created_at,
      content: draft.content,
      tags: draft.tags,
    }, sk);
  };
}

// Step 3: Set up stores
console.log("\n=== Step 2: Set up HashTree with BlossomStore ===");
const signer = createSigner(privateKey);

const blossomStore = new BlossomStore({
  servers: [
    { url: "https://blossom.primal.net", read: true, write: true },
  ],
  signer,
  logger: (entry) => {
    console.log(`  [blossom] ${entry.operation} ${entry.hash?.slice(0, 12)}... on ${entry.server} -> ${entry.success ? "OK" : "FAIL"} ${entry.error || ""}`);
  },
});

const localStore = new MemoryStore();
const store = new FallbackStore({
  primary: localStore,
  fallbacks: [blossomStore],
});

const tree = new HashTree({ store });
console.log("HashTree created with BlossomStore");

// Step 4: Create a test file (small JPEG-like data)
console.log("\n=== Step 3: Store a test file ===");
const testData = new TextEncoder().encode("Hello from Nostr Photos test! " + Date.now());
console.log("Test data size:", testData.length, "bytes");

try {
  const { cid: fileCid, size } = await tree.putFile(testData);
  console.log("File stored locally");
  console.log("  CID hash:", toHex(fileCid.hash));
  console.log("  CID key:", fileCid.key ? toHex(fileCid.key) : "none (unencrypted)");
  console.log("  Size:", size);

  // Step 5: Create a directory with the file
  console.log("\n=== Step 4: Create directory ===");
  const { cid: dirCid } = await tree.putDirectory([
    { name: "test_photo.txt", cid: fileCid, size, type: LinkType.File },
  ]);
  console.log("Directory created");
  console.log("  Dir CID hash:", toHex(dirCid.hash));

  // Step 6: Push to Blossom
  console.log("\n=== Step 5: Push to Blossom ===");
  const pushResult = await tree.push(dirCid, blossomStore, {
    concurrency: 2,
    onProgress: (current, total) => {
      console.log(`  Progress: ${current}/${total}`);
    },
    onBlock: (hash, status, error) => {
      console.log(`  Block ${toHex(hash).slice(0, 12)}... -> ${status}${error ? ": " + error.message : ""}`);
    },
  });
  console.log("Push complete:");
  console.log("  Pushed:", pushResult.pushed);
  console.log("  Skipped:", pushResult.skipped);
  console.log("  Failed:", pushResult.failed);
  console.log("  Bytes:", pushResult.bytes);
  if (pushResult.errors.length > 0) {
    console.log("  Errors:", pushResult.errors.map(e => e.error.message));
  }

  // Step 7: Verify we can read it back from Blossom
  console.log("\n=== Step 6: Verify — read back from Blossom ===");
  const remoteTree = new HashTree({ store: blossomStore });
  const entries = await remoteTree.listDirectory(dirCid);
  console.log("Directory listing from Blossom:");
  for (const entry of entries) {
    console.log(`  ${entry.name} (${entry.size} bytes, type: ${entry.type})`);
  }

  if (entries.length > 0) {
    const readBack = await remoteTree.readFile(entries[0].cid);
    if (readBack) {
      const text = new TextDecoder().decode(readBack);
      console.log("  Content:", text);
      console.log("\n✅ SUCCESS — HashTree + Blossom working end-to-end!");
    } else {
      console.log("\n❌ FAIL — Could not read file back from Blossom");
    }
  }

  // Step 8: Publish root to Nostr
  console.log("\n=== Step 7: Publish root to Nostr ===");
  const rootHex = toHex(dirCid.hash);
  const event = finalizeEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: [
      ["d", "photos"],
      ["hash", rootHex],
    ],
  }, privateKey);
  console.log("Event created:", event.id.slice(0, 16) + "...");

  const relay = "wss://relay.damus.io";
  try {
    const ws = new WebSocket(relay);
    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify(["EVENT", event]));
        console.log("Event sent to", relay);
        setTimeout(() => { ws.close(); resolve(); }, 2000);
      };
      ws.onerror = (e) => reject(e);
      setTimeout(() => reject(new Error("timeout")), 5000);
    });
    console.log("✅ Published to Nostr");
  } catch (e) {
    console.log("❌ Failed to publish:", e.message);
  }

  console.log("\n=== Summary ===");
  console.log("npub:", npub);
  console.log("Tree name: photos");
  console.log("Root hash:", rootHex);
  console.log("Check at: files.iris.to/#/" + npub + "/photos");

} catch (e) {
  console.error("\n❌ ERROR:", e.message);
  console.error(e.stack);
}
