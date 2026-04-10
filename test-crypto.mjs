/**
 * Test: verify our noble-based crypto matches Web Crypto exactly.
 * Run with: node test-crypto.mjs
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { gcm } from "@noble/ciphers/aes.js";

const CHK_SALT = new TextEncoder().encode("hashtree-chk");
const CHK_INFO = new TextEncoder().encode("encryption-key");
const IV_SIZE = 12;

// Test data
const plaintext = new TextEncoder().encode("Hello from Nostr Photos!");
console.log("Plaintext:", new TextDecoder().decode(plaintext));

// --- Noble path (our polyfill) ---
const nobleContentHash = sha256(plaintext);
const nobleDerivedKey = hkdf(sha256, nobleContentHash, CHK_SALT, CHK_INFO, 32);
const nobleNonce = new Uint8Array(IV_SIZE); // zero nonce
const nobleAes = gcm(new Uint8Array(nobleDerivedKey), nobleNonce);
const nobleCiphertext = nobleAes.encrypt(plaintext);

console.log("\n--- Noble (our polyfill) ---");
console.log("Content hash:", hex(nobleContentHash));
console.log("Derived key:", hex(nobleDerivedKey));
console.log("Ciphertext:", hex(nobleCiphertext));
console.log("Ciphertext length:", nobleCiphertext.length, "(plaintext:", plaintext.length, "+ 16 tag)");

// --- Web Crypto path (what @hashtree/core uses in browsers) ---
const wcHash = new Uint8Array(await crypto.subtle.digest("SHA-256", plaintext));

const hkdfKey = await crypto.subtle.importKey("raw", wcHash, { name: "HKDF" }, false, ["deriveKey"]);
const wcDerivedKey = await crypto.subtle.deriveKey(
  { name: "HKDF", salt: CHK_SALT, info: CHK_INFO, hash: "SHA-256" },
  hkdfKey,
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"]
);
const wcDerivedKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", wcDerivedKey));

const wcCiphertext = new Uint8Array(
  await crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(IV_SIZE) }, wcDerivedKey, plaintext)
);

console.log("\n--- Web Crypto (browser standard) ---");
console.log("Content hash:", hex(wcHash));
console.log("Derived key:", hex(wcDerivedKeyRaw));
console.log("Ciphertext:", hex(wcCiphertext));
console.log("Ciphertext length:", wcCiphertext.length);

// --- Compare ---
console.log("\n--- Comparison ---");
console.log("Hashes match:", hex(nobleContentHash) === hex(wcHash));
console.log("Keys match:", hex(nobleDerivedKey) === hex(wcDerivedKeyRaw));
console.log("Ciphertexts match:", hex(nobleCiphertext) === hex(wcCiphertext));

// Verify decryption with noble
const nobleDecAes = gcm(new Uint8Array(nobleDerivedKey), nobleNonce);
const nobleDecrypted = nobleDecAes.decrypt(nobleCiphertext);
console.log("Noble decrypt OK:", new TextDecoder().decode(nobleDecrypted) === "Hello from Nostr Photos!");

// Cross-decrypt: noble ciphertext with Web Crypto
const wcCrossDecrypted = new Uint8Array(
  await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(IV_SIZE) }, wcDerivedKey, nobleCiphertext)
);
console.log("Cross-decrypt (noble→WebCrypto) OK:", new TextDecoder().decode(wcCrossDecrypted) === "Hello from Nostr Photos!");

if (hex(nobleCiphertext) === hex(wcCiphertext)) {
  console.log("\n✅ PASS — Noble output is byte-for-byte identical to Web Crypto");
} else {
  console.log("\n❌ FAIL — Outputs differ!");
}

function hex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
