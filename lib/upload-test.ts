/**
 * On-device test: upload bytes to Blossom, download them back, compare hashes.
 * Runs on the phone to test the actual fetch polyfill path.
 */
import { BlossomStore, MemoryStore, FallbackStore, HashTree, toHex, LinkType } from "@hashtree/core";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { log } from "./logger";

export async function runUploadTest(privateKey: Uint8Array): Promise<string> {
  const pubkey = getPublicKey(privateKey);

  const signer = async (draft: any) => {
    return finalizeEvent({
      kind: draft.kind,
      created_at: draft.created_at,
      content: draft.content,
      tags: draft.tags,
    }, privateKey) as any;
  };

  const servers = [
    { url: "https://upload.iris.to", read: true, write: true },
    { url: "https://cdn.iris.to", read: true, write: false },
    { url: "https://blossom.primal.net", read: true, write: true },
  ];

  log("[TEST] Starting upload round-trip test...");

  // Test 1: Raw BlossomStore put/get
  log("[TEST] === Test 1: Raw BlossomStore put/get ===");
  const blossom = new BlossomStore({
    servers,
    signer,
    logger: (e) => {
      log(`[TEST-B] ${e.operation} ${e.hash?.slice(0, 12)}... ${e.server.split("//")[1]} ${e.success ? "OK" : "FAIL"} ${e.error || ""}`);
    },
  });

  const testData = new Uint8Array(132);
  for (let i = 0; i < testData.length; i++) testData[i] = i % 256;
  const testHash = sha256(testData);
  log("[TEST] Test data: " + testData.length + " bytes, hash: " + bytesToHex(testHash).slice(0, 16) + "...");

  // First verify the File.write → File.bytes round-trip
  const { File: TestFile, Paths: TestPaths } = require("expo-file-system/next");
  const tf = new TestFile(TestPaths.cache, "test_write.bin");
  tf.write(testData);
  const readBack = tf.bytesSync();
  const readHash = bytesToHex(sha256(readBack));
  const origHash = bytesToHex(testHash);
  log("[TEST] File write/read roundtrip: wrote " + testData.length + "b, read " + readBack.length + "b");
  log("[TEST] Write hash: " + origHash.slice(0, 16) + " Read hash: " + readHash.slice(0, 16) + " Match: " + (origHash === readHash));
  if (origHash !== readHash) {
    for (let i = 0; i < Math.max(testData.length, readBack.length); i++) {
      if (testData[i] !== readBack[i]) {
        log("[TEST] First file mismatch at byte " + i + ": wrote " + testData[i] + " read " + readBack[i]);
        break;
      }
    }
  }
  try { tf.delete(); } catch {}

  const putOk = await blossom.put(testHash, testData);
  log("[TEST] put result: " + putOk);

  // Bypass BlossomStore — fetch raw bytes directly to see what server has
  const hashHex = bytesToHex(testHash);
  log("[TEST] Fetching raw bytes from server...");
  try {
    const rawResp = await globalThis.fetch(`https://blossom.primal.net/${hashHex}.bin`);
    log("[TEST] Raw GET status: " + rawResp.status);
    if (rawResp.ok) {
      const rawBuf = await rawResp.arrayBuffer();
      const rawBytes = new Uint8Array(rawBuf);
      const serverHash = bytesToHex(sha256(rawBytes));
      log("[TEST] Server returned: " + rawBytes.length + " bytes");
      log("[TEST] Server hash:   " + serverHash.slice(0, 32));
      log("[TEST] Expected hash: " + hashHex.slice(0, 32));
      log("[TEST] Match: " + (serverHash === hashHex));
      if (serverHash !== hashHex) {
        log("[TEST] Server bytes (first 20): " + Array.from(rawBytes.slice(0, 20)).join(","));
        log("[TEST] Local bytes  (first 20): " + Array.from(testData.slice(0, 20)).join(","));
        for (let i = 0; i < Math.min(rawBytes.length, testData.length); i++) {
          if (rawBytes[i] !== testData[i]) {
            log("[TEST] First diff at byte " + i + ": server=" + rawBytes[i] + " local=" + testData[i]);
            break;
          }
        }
        if (rawBytes.length !== testData.length) {
          log("[TEST] Length diff: server=" + rawBytes.length + " local=" + testData.length);
        }
      }
    }
  } catch (e: any) {
    log("[TEST] Raw fetch error: " + e.message);
  }

  const getData = await blossom.get(testHash);
  if (getData) {
    const getHash = bytesToHex(sha256(getData));
    const expectedHash = bytesToHex(testHash);
    log("[TEST] get returned: " + getData.length + " bytes, hash: " + getHash.slice(0, 16) + "...");
    log("[TEST] Expected hash: " + expectedHash.slice(0, 16) + "...");
    log("[TEST] Match: " + (getHash === expectedHash));
    if (getHash !== expectedHash) {
      // Find first mismatch
      for (let i = 0; i < Math.max(testData.length, getData.length); i++) {
        if (testData[i] !== getData[i]) {
          log("[TEST] First mismatch at byte " + i + ": sent " + testData[i] + " got " + getData[i]);
          log("[TEST] Sent length: " + testData.length + " Got length: " + getData.length);
          break;
        }
      }
      return "FAIL: Hash mismatch on raw put/get";
    }
  } else {
    log("[TEST] get returned null!");
    return "FAIL: Could not read back data";
  }

  // Test 2: Full HashTree flow (2 photos)
  log("[TEST] === Test 2: HashTree 2-photo flow ===");

  const mem1 = new MemoryStore();
  const store1 = new FallbackStore({ primary: mem1, fallbacks: [blossom] });
  const tree1 = new HashTree({ store: store1 });

  const photo1 = new Uint8Array(500);
  for (let i = 0; i < photo1.length; i++) photo1[i] = (i * 7) % 256;
  const { cid: file1, size: size1 } = await tree1.putFile(photo1, { unencrypted: true });
  const { cid: root1 } = await tree1.putDirectory(
    [{ name: "test1.jpg", cid: file1, size: size1, type: LinkType.File }],
    { unencrypted: true }
  );
  log("[TEST] Photo 1 root: " + toHex(root1.hash).slice(0, 16) + "...");

  await tree1.push(root1, blossom, { concurrency: 2 });
  log("[TEST] Photo 1 pushed");

  // Verify root1 readable from Blossom
  const root1Data = await blossom.get(root1.hash);
  if (root1Data) {
    const root1ServerHash = bytesToHex(sha256(root1Data));
    const root1ExpectedHash = toHex(root1.hash);
    log("[TEST] Root1 server hash: " + root1ServerHash.slice(0, 16) + "...");
    log("[TEST] Root1 expected:    " + root1ExpectedHash.slice(0, 16) + "...");
    log("[TEST] Root1 match: " + (root1ServerHash === root1ExpectedHash));
    if (root1ServerHash !== root1ExpectedHash) {
      return "FAIL: Root1 hash mismatch after push";
    }
  } else {
    return "FAIL: Root1 not readable from Blossom";
  }

  // Photo 2: fresh tree, try setEntry on root1
  const mem2 = new MemoryStore();
  const store2 = new FallbackStore({ primary: mem2, fallbacks: [blossom] });
  const tree2 = new HashTree({ store: store2 });

  const photo2 = new Uint8Array(500);
  for (let i = 0; i < photo2.length; i++) photo2[i] = (i * 13) % 256;
  const { cid: file2, size: size2 } = await tree2.putFile(photo2, { unencrypted: true });

  try {
    const root2 = await tree2.setEntry(root1, [], "test2.jpg", file2, size2, LinkType.File);
    const entries = await tree2.listDirectory(root2);
    log("[TEST] setEntry succeeded, entries: " + entries.length);
    for (const e of entries) log("[TEST]   - " + e.name);
    if (entries.length === 2) {
      return "PASS: Both photos in tree";
    } else {
      return "FAIL: Expected 2 entries, got " + entries.length;
    }
  } catch (e: any) {
    log("[TEST] setEntry FAILED: " + e.message);
    return "FAIL: setEntry error: " + e.message;
  }
}
