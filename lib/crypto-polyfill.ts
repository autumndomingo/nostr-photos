/**
 * crypto.subtle polyfill for React Native using audited @noble libraries.
 *
 * Implements only the subset that @hashtree/core needs:
 * - digest('SHA-256')
 * - importKey('raw', ..., 'AES-GCM' | 'HKDF')
 * - deriveKey({ name: 'HKDF' })
 * - encrypt/decrypt({ name: 'AES-GCM' })
 *
 * Backed by:
 * - @noble/hashes (SHA-256, HKDF) — Cure53 audited
 * - @noble/ciphers (AES-256-GCM) — Cure53 audited
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 as sha256Hash } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

type CryptoKeyShim = {
  _raw: Uint8Array;
  _algorithm: string;
  _usages: string[];
};

if (typeof globalThis.crypto === "undefined") {
  (globalThis as any).crypto = {};
}

if (typeof globalThis.crypto.subtle === "undefined") {
  (globalThis.crypto as any).subtle = {
    async digest(
      algorithm: string | { name: string },
      data: ArrayBuffer
    ): Promise<ArrayBuffer> {
      const alg = typeof algorithm === "string" ? algorithm : algorithm.name;
      if (alg !== "SHA-256") throw new Error(`Unsupported digest: ${alg}`);
      const hash = sha256(new Uint8Array(data));
      return hash.buffer.slice(
        hash.byteOffset,
        hash.byteOffset + hash.byteLength
      ) as ArrayBuffer;
    },

    async importKey(
      format: string,
      keyData: ArrayBuffer,
      algorithm: any,
      extractable: boolean,
      usages: string[]
    ): Promise<CryptoKeyShim> {
      if (format !== "raw") throw new Error(`Unsupported format: ${format}`);
      const algoName =
        typeof algorithm === "string" ? algorithm : algorithm.name;
      return {
        _raw: new Uint8Array(keyData),
        _algorithm: algoName,
        _usages: usages,
      };
    },

    async deriveKey(
      algorithm: any,
      baseKey: CryptoKeyShim,
      derivedKeyType: any,
      extractable: boolean,
      keyUsages: string[]
    ): Promise<CryptoKeyShim> {
      if (algorithm.name !== "HKDF")
        throw new Error(`Unsupported deriveKey: ${algorithm.name}`);

      const salt = new Uint8Array(algorithm.salt || new ArrayBuffer(0));
      const info = new Uint8Array(algorithm.info || new ArrayBuffer(0));
      const lengthBytes = (derivedKeyType.length || 256) / 8;

      const derived = hkdf(sha256Hash, baseKey._raw, salt, info, lengthBytes);

      return {
        _raw: new Uint8Array(derived),
        _algorithm: derivedKeyType.name || "AES-GCM",
        _usages: keyUsages,
      };
    },

    async encrypt(
      algorithm: any,
      key: CryptoKeyShim,
      data: ArrayBuffer
    ): Promise<ArrayBuffer> {
      if (algorithm.name !== "AES-GCM")
        throw new Error(`Unsupported encrypt: ${algorithm.name}`);
      const nonce = new Uint8Array(algorithm.iv);
      const plaintext = new Uint8Array(data);
      const aes = gcm(key._raw, nonce);
      const ciphertext = aes.encrypt(plaintext);
      return ciphertext.buffer.slice(
        ciphertext.byteOffset,
        ciphertext.byteOffset + ciphertext.byteLength
      ) as ArrayBuffer;
    },

    async decrypt(
      algorithm: any,
      key: CryptoKeyShim,
      data: ArrayBuffer
    ): Promise<ArrayBuffer> {
      if (algorithm.name !== "AES-GCM")
        throw new Error(`Unsupported decrypt: ${algorithm.name}`);
      const nonce = new Uint8Array(algorithm.iv);
      const ciphertext = new Uint8Array(data);
      const aes = gcm(key._raw, nonce);
      const plaintext = aes.decrypt(ciphertext);
      return plaintext.buffer.slice(
        plaintext.byteOffset,
        plaintext.byteOffset + plaintext.byteLength
      ) as ArrayBuffer;
    },

    async generateKey(
      algorithm: any,
      extractable: boolean,
      keyUsages: string[]
    ): Promise<CryptoKeyShim> {
      const bytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(bytes);
      return { _raw: bytes, _algorithm: algorithm.name, _usages: keyUsages };
    },

    async exportKey(format: string, key: CryptoKeyShim): Promise<ArrayBuffer> {
      if (format !== "raw") throw new Error(`Unsupported export: ${format}`);
      return key._raw.buffer.slice(
        key._raw.byteOffset,
        key._raw.byteOffset + key._raw.byteLength
      ) as ArrayBuffer;
    },
  };
}
