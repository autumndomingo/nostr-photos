import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { nsecEncode, npubEncode, decode } from "nostr-tools/nip19";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const PRIVATE_KEY_STORE = "nostr_private_key";

// On web, SecureStore isn't available — fall back to localStorage
const storage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      return localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

// Generate a brand new Nostr keypair
export function createAccount(): {
  privateKey: Uint8Array;
  publicKeyHex: string;
  nsec: string;
  npub: string;
} {
  const privateKey = generateSecretKey();
  const publicKeyHex = getPublicKey(privateKey);
  return {
    privateKey,
    publicKeyHex,
    nsec: nsecEncode(privateKey),
    npub: npubEncode(publicKeyHex),
  };
}

// Save private key securely on device
export async function savePrivateKey(privateKey: Uint8Array): Promise<void> {
  const hex = bytesToHex(privateKey);
  await storage.setItem(PRIVATE_KEY_STORE, hex);
}

// Load private key from device (returns null if not found)
export async function loadPrivateKey(): Promise<Uint8Array | null> {
  const hex = await storage.getItem(PRIVATE_KEY_STORE);
  if (!hex) return null;
  return hexToBytes(hex);
}

// Delete the stored private key (logout)
export async function deletePrivateKey(): Promise<void> {
  await storage.deleteItem(PRIVATE_KEY_STORE);
}

// Convert an nsec string to a private key Uint8Array
export function nsecToPrivateKey(nsec: string): Uint8Array {
  const { type, data } = decode(nsec);
  if (type !== "nsec") throw new Error("Not a valid nsec key");
  return data as Uint8Array;
}

// Get the npub for a private key
export function getNpub(privateKey: Uint8Array): string {
  const pubHex = getPublicKey(privateKey);
  return npubEncode(pubHex);
}

// Get the public key hex for a private key
export function getPublicKeyHex(privateKey: Uint8Array): string {
  return getPublicKey(privateKey);
}

// Publish a Merkle root hash to Nostr relays
// Uses kind 30078 with "hash" tag — matches the hashtree protocol format
// so tools like files.iris.to can find and display the tree
export async function publishMerkleRoot(
  privateKey: Uint8Array,
  rootHash: string,
  leafCount: number
): Promise<void> {
  const event = finalizeEvent(
    {
      kind: 30078,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags: [
        ["d", "photos"],
        ["hash", rootHash],
      ],
    },
    privateKey
  );

  // Publish to popular relays
  const relays = [
    "wss://relay.damus.io",
    "wss://relay.nostr.band",
    "wss://nos.lol",
    "wss://relay.primal.net",
  ];

  const promises = relays.map(async (url) => {
    try {
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          ws.send(JSON.stringify(["EVENT", event]));
          // Give it a moment to send, then close
          setTimeout(() => {
            ws.close();
            resolve();
          }, 1500);
        };
        ws.onerror = () => reject(new Error(`Failed to connect to ${url}`));
        setTimeout(() => reject(new Error("Timeout")), 5000);
      });
    } catch (e) {
      console.warn(`Failed to publish to ${url}:`, e);
    }
  });

  await Promise.allSettled(promises);
}
