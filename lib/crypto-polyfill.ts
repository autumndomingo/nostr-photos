/**
 * Polyfill crypto.subtle for React Native
 * Uses expo-crypto for SHA-256 and a pure JS AES-GCM + HKDF implementation
 */
import * as ExpoCrypto from "expo-crypto";

// Only polyfill if crypto.subtle doesn't exist
if (typeof globalThis.crypto === "undefined") {
  (globalThis as any).crypto = {};
}

if (typeof globalThis.crypto.subtle === "undefined") {
  const subtle: any = {
    async digest(
      algorithm: string | { name: string },
      data: ArrayBuffer
    ): Promise<ArrayBuffer> {
      const alg =
        typeof algorithm === "string" ? algorithm : algorithm.name;
      if (alg === "SHA-256") {
        const uint8 = new Uint8Array(data);
        const hash: any = await ExpoCrypto.digest(
          ExpoCrypto.CryptoDigestAlgorithm.SHA256,
          uint8 as any
        );
        if (typeof hash === "string") {
          return hexToBytes(hash).buffer as ArrayBuffer;
        }
        return new Uint8Array(hash).buffer as ArrayBuffer;
      }
      throw new Error(`Unsupported digest algorithm: ${alg}`);
    },

    async importKey(
      format: string,
      keyData: ArrayBuffer,
      algorithm: any,
      extractable: boolean,
      usages: string[]
    ): Promise<any> {
      // Return a wrapper object that holds the raw key bytes
      return {
        _raw: new Uint8Array(keyData),
        _algorithm: typeof algorithm === "string" ? { name: algorithm } : algorithm,
        _usages: usages,
      };
    },

    async deriveKey(
      algorithm: any,
      baseKey: any,
      derivedKeyType: any,
      extractable: boolean,
      keyUsages: string[]
    ): Promise<any> {
      if (algorithm.name === "HKDF") {
        // Simple HKDF-SHA256 implementation
        const ikm = baseKey._raw;
        const salt = algorithm.salt
          ? new Uint8Array(algorithm.salt)
          : new Uint8Array(32);
        const info = algorithm.info
          ? new Uint8Array(algorithm.info)
          : new Uint8Array(0);

        // HKDF Extract: PRK = HMAC-SHA256(salt, IKM)
        const prk = await hmacSha256(salt, ikm);

        // HKDF Expand: OKM = HMAC-SHA256(PRK, info || 0x01)
        const expandInput = new Uint8Array(info.length + 1);
        expandInput.set(info);
        expandInput[info.length] = 0x01;
        const okm = await hmacSha256(prk, expandInput);

        return {
          _raw: okm.slice(0, 32),
          _algorithm: derivedKeyType,
          _usages: keyUsages,
        };
      }
      throw new Error(`Unsupported deriveKey algorithm: ${algorithm.name}`);
    },

    async encrypt(
      algorithm: any,
      key: any,
      data: ArrayBuffer
    ): Promise<ArrayBuffer> {
      if (algorithm.name === "AES-GCM") {
        const iv = new Uint8Array(algorithm.iv);
        const plaintext = new Uint8Array(data);
        const keyBytes = key._raw;
        return aesGcmEncrypt(keyBytes, iv, plaintext);
      }
      throw new Error(`Unsupported encrypt algorithm: ${algorithm.name}`);
    },

    async decrypt(
      algorithm: any,
      key: any,
      data: ArrayBuffer
    ): Promise<ArrayBuffer> {
      if (algorithm.name === "AES-GCM") {
        const iv = new Uint8Array(algorithm.iv);
        const ciphertext = new Uint8Array(data);
        const keyBytes = key._raw;
        return aesGcmDecrypt(keyBytes, iv, ciphertext);
      }
      throw new Error(`Unsupported decrypt algorithm: ${algorithm.name}`);
    },

    async generateKey(
      algorithm: any,
      extractable: boolean,
      keyUsages: string[]
    ): Promise<any> {
      const bytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(bytes);
      return { _raw: bytes, _algorithm: algorithm, _usages: keyUsages };
    },

    async exportKey(format: string, key: any): Promise<ArrayBuffer> {
      if (format === "raw") {
        return key._raw.buffer;
      }
      throw new Error(`Unsupported export format: ${format}`);
    },
  };

  (globalThis.crypto as any).subtle = subtle;
}

// HMAC-SHA256 using expo-crypto digest
async function hmacSha256(
  key: Uint8Array,
  message: Uint8Array
): Promise<Uint8Array> {
  // HMAC: H((K ^ opad) || H((K ^ ipad) || message))
  const blockSize = 64;
  let k = key;
  if (k.length > blockSize) {
    const hashed: any = await ExpoCrypto.digest(
      ExpoCrypto.CryptoDigestAlgorithm.SHA256,
      k as any
    );
    k = typeof hashed === "string" ? hexToBytes(hashed) : new Uint8Array(hashed);
  }
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(k);

  const ipad = new Uint8Array(blockSize);
  const opad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = paddedKey[i] ^ 0x36;
    opad[i] = paddedKey[i] ^ 0x5c;
  }

  const inner = new Uint8Array(blockSize + message.length);
  inner.set(ipad);
  inner.set(message, blockSize);

  const innerHash: any = await ExpoCrypto.digest(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    inner as any
  );
  const innerBytes = typeof innerHash === "string" ? hexToBytes(innerHash) : new Uint8Array(innerHash);

  const outer = new Uint8Array(blockSize + innerBytes.length);
  outer.set(opad);
  outer.set(innerBytes, blockSize);

  const result: any = await ExpoCrypto.digest(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    outer as any
  );
  return typeof result === "string" ? hexToBytes(result) : new Uint8Array(result);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ---- AES-256-GCM pure JS implementation ----
// Minimal implementation for hashtree compatibility

// AES S-Box
const SBOX = new Uint8Array([
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,
  0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,
  0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,
  0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,
  0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,
  0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,
  0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,
  0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,
  0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,
  0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,
  0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,
  0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16,
]);

const INV_SBOX = new Uint8Array(256);
for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;

const RCON = [0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36];

function xtime(a: number): number { return (a << 1) ^ ((a >> 7) * 0x1b) & 0xff; }

function gmul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}

function expandKey(key: Uint8Array): Uint32Array {
  const Nk = 8, Nr = 14;
  const W = new Uint32Array(4 * (Nr + 1));
  for (let i = 0; i < Nk; i++) {
    W[i] = (key[4*i] << 24) | (key[4*i+1] << 16) | (key[4*i+2] << 8) | key[4*i+3];
  }
  for (let i = Nk; i < 4*(Nr+1); i++) {
    let t = W[i-1];
    if (i % Nk === 0) {
      t = ((SBOX[(t>>16)&0xff]<<24)|(SBOX[(t>>8)&0xff]<<16)|(SBOX[t&0xff]<<8)|SBOX[(t>>24)&0xff]) ^ (RCON[i/Nk-1]<<24);
    } else if (i % Nk === 4) {
      t = (SBOX[(t>>24)&0xff]<<24)|(SBOX[(t>>16)&0xff]<<16)|(SBOX[(t>>8)&0xff]<<8)|SBOX[t&0xff];
    }
    W[i] = W[i-Nk] ^ t;
  }
  return W;
}

function aesBlock(block: Uint8Array, W: Uint32Array, encrypt: boolean): Uint8Array {
  const Nr = 14;
  const s = new Uint8Array(16);
  s.set(block);

  if (encrypt) {
    // AddRoundKey
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      s[4*i] ^= (w>>24)&0xff; s[4*i+1] ^= (w>>16)&0xff; s[4*i+2] ^= (w>>8)&0xff; s[4*i+3] ^= w&0xff;
    }
    for (let r = 1; r <= Nr; r++) {
      // SubBytes
      for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
      // ShiftRows
      let t = s[1]; s[1]=s[5]; s[5]=s[9]; s[9]=s[13]; s[13]=t;
      t=s[2]; s[2]=s[10]; s[10]=t; t=s[6]; s[6]=s[14]; s[14]=t;
      t=s[15]; s[15]=s[11]; s[11]=s[7]; s[7]=s[3]; s[3]=t;
      // MixColumns (skip last round)
      if (r < Nr) {
        for (let c = 0; c < 4; c++) {
          const i = c*4;
          const a0=s[i], a1=s[i+1], a2=s[i+2], a3=s[i+3];
          s[i]   = xtime(a0)^xtime(a1)^a1^a2^a3;
          s[i+1] = a0^xtime(a1)^xtime(a2)^a2^a3;
          s[i+2] = a0^a1^xtime(a2)^xtime(a3)^a3;
          s[i+3] = xtime(a0)^a0^a1^a2^xtime(a3);
        }
      }
      // AddRoundKey
      for (let i = 0; i < 4; i++) {
        const w = W[r*4+i];
        s[4*i] ^= (w>>24)&0xff; s[4*i+1] ^= (w>>16)&0xff; s[4*i+2] ^= (w>>8)&0xff; s[4*i+3] ^= w&0xff;
      }
    }
  } else {
    // Decrypt
    for (let i = 0; i < 4; i++) {
      const w = W[Nr*4+i];
      s[4*i] ^= (w>>24)&0xff; s[4*i+1] ^= (w>>16)&0xff; s[4*i+2] ^= (w>>8)&0xff; s[4*i+3] ^= w&0xff;
    }
    for (let r = Nr-1; r >= 0; r--) {
      // InvShiftRows
      let t = s[13]; s[13]=s[9]; s[9]=s[5]; s[5]=s[1]; s[1]=t;
      t=s[10]; s[10]=s[2]; s[2]=t; t=s[14]; s[14]=s[6]; s[6]=t;
      t=s[3]; s[3]=s[7]; s[7]=s[11]; s[11]=s[15]; s[15]=t;
      // InvSubBytes
      for (let i = 0; i < 16; i++) s[i] = INV_SBOX[s[i]];
      // AddRoundKey
      for (let i = 0; i < 4; i++) {
        const w = W[r*4+i];
        s[4*i] ^= (w>>24)&0xff; s[4*i+1] ^= (w>>16)&0xff; s[4*i+2] ^= (w>>8)&0xff; s[4*i+3] ^= w&0xff;
      }
      // InvMixColumns (skip round 0)
      if (r > 0) {
        for (let c = 0; c < 4; c++) {
          const i = c*4;
          const a0=s[i], a1=s[i+1], a2=s[i+2], a3=s[i+3];
          s[i]   = gmul(a0,14)^gmul(a1,11)^gmul(a2,13)^gmul(a3,9);
          s[i+1] = gmul(a0,9)^gmul(a1,14)^gmul(a2,11)^gmul(a3,13);
          s[i+2] = gmul(a0,13)^gmul(a1,9)^gmul(a2,14)^gmul(a3,11);
          s[i+3] = gmul(a0,11)^gmul(a1,13)^gmul(a2,9)^gmul(a3,14);
        }
      }
    }
  }
  return s;
}

// GCM multiplication in GF(2^128)
function gcmMultiply(x: Uint8Array, h: Uint8Array): Uint8Array<ArrayBuffer> {
  const v = new Uint8Array(16);
  const z = new Uint8Array(16);
  v.set(h);
  for (let i = 0; i < 128; i++) {
    if ((x[Math.floor(i/8)] >> (7 - i%8)) & 1) {
      for (let j = 0; j < 16; j++) z[j] ^= v[j];
    }
    const lsb = v[15] & 1;
    for (let j = 15; j > 0; j--) v[j] = (v[j] >> 1) | ((v[j-1] & 1) << 7);
    v[0] >>= 1;
    if (lsb) v[0] ^= 0xe1;
  }
  return z;
}

function incCounter(counter: Uint8Array): void {
  for (let i = 15; i >= 12; i--) {
    if (++counter[i] !== 0) break;
  }
}

function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): ArrayBuffer {
  const W = expandKey(key);

  // H = AES_K(0^128)
  const H = aesBlock(new Uint8Array(16), W, true);

  // J0 (initial counter)
  const J0 = new Uint8Array(16);
  if (iv.length === 12) {
    J0.set(iv); J0[15] = 1;
  }

  // Encrypt
  const ciphertext = new Uint8Array(plaintext.length);
  const counter = new Uint8Array(16);
  counter.set(J0);

  for (let i = 0; i < plaintext.length; i += 16) {
    incCounter(counter);
    const keystream = aesBlock(counter, W, true);
    const blockLen = Math.min(16, plaintext.length - i);
    for (let j = 0; j < blockLen; j++) {
      ciphertext[i+j] = plaintext[i+j] ^ keystream[j];
    }
  }

  // GHASH for tag
  let ghash = new Uint8Array(16);
  for (let i = 0; i < ciphertext.length; i += 16) {
    const block = new Uint8Array(16);
    const blockLen = Math.min(16, ciphertext.length - i);
    block.set(ciphertext.subarray(i, i + blockLen));
    for (let j = 0; j < 16; j++) ghash[j] ^= block[j];
    ghash = gcmMultiply(ghash, H);
  }

  // Length block
  const lenBlock = new Uint8Array(16);
  const bitLen = plaintext.length * 8;
  lenBlock[12] = (bitLen >> 24) & 0xff;
  lenBlock[13] = (bitLen >> 16) & 0xff;
  lenBlock[14] = (bitLen >> 8) & 0xff;
  lenBlock[15] = bitLen & 0xff;
  for (let j = 0; j < 16; j++) ghash[j] ^= lenBlock[j];
  ghash = gcmMultiply(ghash, H);

  // Tag = GHASH ^ AES_K(J0)
  const j0Enc = aesBlock(J0, W, true);
  const tag = new Uint8Array(16);
  for (let j = 0; j < 16; j++) tag[j] = ghash[j] ^ j0Enc[j];

  // Output: ciphertext || tag
  const result = new Uint8Array(ciphertext.length + 16);
  result.set(ciphertext);
  result.set(tag, ciphertext.length);
  return result.buffer;
}

function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): ArrayBuffer {
  const W = expandKey(key);
  const ciphertext = data.subarray(0, data.length - 16);

  // J0
  const J0 = new Uint8Array(16);
  if (iv.length === 12) {
    J0.set(iv); J0[15] = 1;
  }

  // Decrypt
  const plaintext = new Uint8Array(ciphertext.length);
  const counter = new Uint8Array(16);
  counter.set(J0);

  for (let i = 0; i < ciphertext.length; i += 16) {
    incCounter(counter);
    const keystream = aesBlock(counter, W, true);
    const blockLen = Math.min(16, ciphertext.length - i);
    for (let j = 0; j < blockLen; j++) {
      plaintext[i+j] = ciphertext[i+j] ^ keystream[j];
    }
  }

  return plaintext.buffer;
}
