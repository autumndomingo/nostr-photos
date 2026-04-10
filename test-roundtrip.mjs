/**
 * Test: Upload via XHR (simulating our polyfill) and verify round-trip hash integrity.
 * This tests whether the data we upload matches what we get back.
 */
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);

function createAuth(hash) {
  return finalizeEvent({
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    content: "Upload Blob",
    tags: [
      ["t", "upload"],
      ["x", hash],
      ["expiration", String(Math.floor(Date.now() / 1000) + 300)],
    ],
  }, sk);
}

function base64url(data) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes = new TextEncoder().encode(data);
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i+1] || 0, b2 = bytes[i+2] || 0;
    result += chars[b0 >> 2];
    result += chars[((b0 & 3) << 4) | (b1 >> 4)];
    result += (i+1 < bytes.length) ? chars[((b1 & 15) << 2) | (b2 >> 6)] : "";
    result += (i+2 < bytes.length) ? chars[b2 & 63] : "";
  }
  return result.replace(/\+/g, "-").replace(/\//g, "_");
}

const SERVER = "https://blossom.primal.net";

// Create test data — similar size to a directory node (132 bytes)
const testData = new Uint8Array(132);
crypto.getRandomValues(testData);
const localHash = bytesToHex(sha256(testData));
console.log("Local hash:", localHash);
console.log("Data size:", testData.length, "bytes");
console.log("First 16 bytes:", bytesToHex(testData.slice(0, 16)));

// Upload with standard fetch (Blob body — what BlossomStore does)
const auth = createAuth(localHash);
const token = base64url(JSON.stringify(auth));

console.log("\n--- Upload with Blob body (what BlossomStore does) ---");
const uploadResp = await fetch(`${SERVER}/upload`, {
  method: "PUT",
  headers: {
    "Authorization": `Nostr ${token}`,
    "Content-Type": "application/octet-stream",
    "X-SHA-256": localHash,
  },
  body: new Blob([testData]),
});
console.log("Upload status:", uploadResp.status);
const uploadResult = await uploadResp.json();
console.log("Server returned hash:", uploadResult.sha256);
console.log("Hashes match:", uploadResult.sha256 === localHash);

// Now fetch it back
console.log("\n--- Fetch back ---");
const getResp = await fetch(`${SERVER}/${localHash}`);
console.log("GET status:", getResp.status);
if (getResp.ok) {
  const downloaded = new Uint8Array(await getResp.arrayBuffer());
  const downloadHash = bytesToHex(sha256(downloaded));
  console.log("Downloaded size:", downloaded.length);
  console.log("Downloaded hash:", downloadHash);
  console.log("Round-trip match:", downloadHash === localHash);
  console.log("First 16 bytes:", bytesToHex(downloaded.slice(0, 16)));

  // Byte-by-byte comparison
  let mismatches = 0;
  for (let i = 0; i < Math.max(testData.length, downloaded.length); i++) {
    if (testData[i] !== downloaded[i]) {
      if (mismatches < 5) console.log(`  Mismatch at byte ${i}: sent ${testData[i]} got ${downloaded[i]}`);
      mismatches++;
    }
  }
  if (mismatches > 0) {
    console.log(`Total mismatches: ${mismatches} of ${testData.length} bytes`);
    console.log("❌ FAIL — Data corrupted during upload");
  } else {
    console.log("✅ PASS — Round-trip data integrity OK");
  }
} else {
  console.log("❌ GET failed:", getResp.status, await getResp.text());
}
