import { File, Paths } from "expo-file-system/next";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { nsecEncode, npubEncode, decode } from "nostr-tools/nip19";
import { bytesToHex, hexToBytes } from "nostr-tools/utils";
import * as nip44 from "nostr-tools/nip44";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { log } from "./logger";
import { clearDeferredText, readDeferredText, writeDeferredText } from "./deferred-file";

const PRIVATE_KEY_STORE = "nostr_private_key";
const PENDING_ROOT_STORAGE_KEY = "nostr_pending_root_publish";
const DEFAULT_TREE_NAME = "photos";
const MERKLE_RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
];
const RELAY_ACK_TIMEOUT_MS = 7000;
const RELAY_CONFIRM_TIMEOUT_MS = 5000;

let lastMerkleRootCreatedAt = 0;
let merklePublishQueue: Promise<unknown> = Promise.resolve();

type PendingMerkleRootPublish = {
  treeName: string;
  rootHash: string;
  rootKey?: string;
  leafCount: number;
  createdAt: number;
  attempts: number;
  updatedAt: number;
  lastError?: string;
};

type RelayPublishAttempt = {
  relay: string;
  accepted: boolean;
  info: string;
};

export type PublishMerkleRootResult = {
  success: boolean;
  pending: boolean;
  treeName: string;
  rootHash: string;
  eventId: string;
  createdAt: number;
  acceptedRelays: string[];
  confirmedRelays: string[];
  relayResults: Array<{
    relay: string;
    accepted: boolean;
    confirmed: boolean;
    info: string;
  }>;
  reason?: string;
};

type PublishMerkleRootOptions = {
  treeName?: string;
};

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

function getPendingPublishFile(): File {
  return new File(Paths.document, "pending-root-publish.json");
}

function readPendingPublishText(): string | null {
  if (Platform.OS === "web") {
    return localStorage.getItem(PENDING_ROOT_STORAGE_KEY);
  }

  return readDeferredText(getPendingPublishFile());
}

function writePendingPublishText(text: string): void {
  if (Platform.OS === "web") {
    localStorage.setItem(PENDING_ROOT_STORAGE_KEY, text);
    return;
  }

  writeDeferredText(getPendingPublishFile(), text);
}

function deletePendingPublishText(): void {
  if (Platform.OS === "web") {
    localStorage.removeItem(PENDING_ROOT_STORAGE_KEY);
    return;
  }

  const file = getPendingPublishFile();
  clearDeferredText(file);
  if (file.exists) {
    file.delete();
  }
}

function queueMerklePublish<T>(task: () => Promise<T>): Promise<T> {
  const result = merklePublishQueue.catch(() => {}).then(task);
  merklePublishQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function nextMerkleRootCreatedAt(previousCreatedAt = 0): number {
  const now = Math.floor(Date.now() / 1000);
  const createdAt = Math.max(now, lastMerkleRootCreatedAt + 1, previousCreatedAt + 1);
  lastMerkleRootCreatedAt = createdAt;
  return createdAt;
}

function getRootHashTag(tags: string[][]): string | undefined {
  return tags.find((tag) => tag[0] === "hash")?.[1];
}

function buildMerkleRootEvent(
  privateKey: Uint8Array,
  record: PendingMerkleRootPublish
) {
  const pubkeyHex = getPublicKey(privateKey);
  const tags: string[][] = [
    ["d", record.treeName],
    ["l", "hashtree"],
    ["hash", record.rootHash],
  ];

  if (record.rootKey) {
    const conversationKey = nip44.v2.utils.getConversationKey(privateKey, pubkeyHex);
    const selfEncrypted = nip44.v2.encrypt(record.rootKey, conversationKey);
    tags.push(["selfEncryptedKey", selfEncrypted]);
  }

  return finalizeEvent(
    {
      kind: 30078,
      created_at: record.createdAt,
      content: "",
      tags,
    },
    privateKey
  );
}

async function savePendingMerkleRootPublish(record: PendingMerkleRootPublish): Promise<void> {
  writePendingPublishText(JSON.stringify(record));
}

async function loadPendingMerkleRootPublish(): Promise<PendingMerkleRootPublish | null> {
  try {
    const text = readPendingPublishText();
    if (!text) return null;
    const parsed = JSON.parse(text) as PendingMerkleRootPublish;
    if (!parsed.rootHash || !parsed.treeName) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingMerkleRootPublish(): Promise<void> {
  deletePendingPublishText();
}

async function publishEventToRelay(
  relay: string,
  event: ReturnType<typeof finalizeEvent>
): Promise<RelayPublishAttempt> {
  return await new Promise((resolve) => {
    const ws = new WebSocket(relay);
    let settled = false;

    const done = (accepted: boolean, info: string) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      resolve({ relay, accepted, info });
    };

    const timeoutId = setTimeout(() => {
      done(false, "timeout");
    }, RELAY_ACK_TIMEOUT_MS);

    ws.onopen = () => {
      ws.send(JSON.stringify(["EVENT", event]));
    };

    ws.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data));
        if (Array.isArray(data) && data[0] === "OK" && data[1] === event.id) {
          clearTimeout(timeoutId);
          done(Boolean(data[2]), data[3] ? String(data[3]) : "");
        }
      } catch {}
    };

    ws.onerror = () => {
      clearTimeout(timeoutId);
      done(false, "socket error");
    };
  });
}

async function confirmMerkleRootOnRelay(
  relay: string,
  event: ReturnType<typeof finalizeEvent>,
  treeName: string,
  rootHash: string
): Promise<boolean> {
  return await new Promise((resolve) => {
    const ws = new WebSocket(relay);
    const subscriptionId = `confirm-${event.id.slice(0, 12)}`;
    let settled = false;

    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      resolve(ok);
    };

    const timeoutId = setTimeout(() => {
      done(false);
    }, RELAY_CONFIRM_TIMEOUT_MS);

    ws.onopen = () => {
      ws.send(
        JSON.stringify([
          "REQ",
          subscriptionId,
          {
            kinds: [30078],
            authors: [event.pubkey],
            "#d": [treeName],
            limit: 10,
          },
        ])
      );
    };

    ws.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data));

        if (Array.isArray(data) && data[0] === "EVENT" && data[1] === subscriptionId) {
          const receivedEvent = data[2] as {
            id?: string;
            created_at?: number;
            tags?: string[][];
          };
          const receivedHash = getRootHashTag(receivedEvent.tags ?? []);

          if (
            receivedEvent.id === event.id ||
            (receivedHash === rootHash && (receivedEvent.created_at ?? 0) >= event.created_at)
          ) {
            clearTimeout(timeoutId);
            done(true);
          }
        } else if (Array.isArray(data) && data[0] === "EOSE" && data[1] === subscriptionId) {
          clearTimeout(timeoutId);
          done(false);
        }
      } catch {}
    };

    ws.onerror = () => {
      clearTimeout(timeoutId);
      done(false);
    };
  });
}

async function attemptMerkleRootPublish(
  privateKey: Uint8Array,
  record: PendingMerkleRootPublish
): Promise<PublishMerkleRootResult> {
  const nextRecord: PendingMerkleRootPublish = {
    ...record,
    createdAt: nextMerkleRootCreatedAt(record.createdAt),
    attempts: record.attempts + 1,
    updatedAt: Date.now(),
    lastError: undefined,
  };
  await savePendingMerkleRootPublish(nextRecord);

  const event = buildMerkleRootEvent(privateKey, nextRecord);
  const publishAttempts = await Promise.all(
    MERKLE_RELAYS.map((relay) => publishEventToRelay(relay, event))
  );
  const acceptedRelays = publishAttempts
    .filter((attempt) => attempt.accepted)
    .map((attempt) => attempt.relay);

  const confirmedRelaySet = new Set<string>();
  if (acceptedRelays.length > 0) {
    const confirmations = await Promise.all(
      acceptedRelays.map(async (relay) => ({
        relay,
        confirmed: await confirmMerkleRootOnRelay(
          relay,
          event,
          nextRecord.treeName,
          nextRecord.rootHash
        ),
      }))
    );
    for (const confirmation of confirmations) {
      if (confirmation.confirmed) {
        confirmedRelaySet.add(confirmation.relay);
      }
    }
  }

  const confirmedRelays = Array.from(confirmedRelaySet);
  const success = confirmedRelays.length > 0;
  const reason =
    acceptedRelays.length === 0
      ? "No relay accepted the event"
      : success
        ? undefined
        : "Accepted by relays but not yet query-confirmed";

  if (success) {
    await clearPendingMerkleRootPublish();
  } else {
    await savePendingMerkleRootPublish({
      ...nextRecord,
      lastError: reason,
      updatedAt: Date.now(),
    });
  }

  return {
    success,
    pending: !success,
    treeName: nextRecord.treeName,
    rootHash: nextRecord.rootHash,
    eventId: event.id,
    createdAt: event.created_at,
    acceptedRelays,
    confirmedRelays,
    relayResults: publishAttempts.map((attempt) => ({
      relay: attempt.relay,
      accepted: attempt.accepted,
      confirmed: confirmedRelaySet.has(attempt.relay),
      info: attempt.info,
    })),
    reason,
  };
}

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
  await clearPendingMerkleRootPublish();
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

// Get the nsec for a private key
export function getNsec(privateKey: Uint8Array): string {
  return nsecEncode(privateKey);
}

// Get the public key hex for a private key
export function getPublicKeyHex(privateKey: Uint8Array): string {
  return getPublicKey(privateKey);
}

// Publish the latest Merkle root to Nostr and keep retrying until confirmed.
export async function publishMerkleRoot(
  privateKey: Uint8Array,
  rootHash: string,
  leafCount: number,
  rootKey?: string,
  options?: PublishMerkleRootOptions
): Promise<PublishMerkleRootResult> {
  return queueMerklePublish(async () => {
    const record: PendingMerkleRootPublish = {
      treeName: options?.treeName ?? DEFAULT_TREE_NAME,
      rootHash,
      rootKey,
      leafCount,
      createdAt: 0,
      attempts: 0,
      updatedAt: Date.now(),
    };
    await savePendingMerkleRootPublish(record);
    return await attemptMerkleRootPublish(privateKey, record);
  });
}

export async function retryPendingMerkleRootPublish(
  providedPrivateKey?: Uint8Array | null
): Promise<PublishMerkleRootResult | null> {
  return queueMerklePublish(async () => {
    const pending = await loadPendingMerkleRootPublish();
    if (!pending) return null;

    const privateKey = providedPrivateKey ?? (await loadPrivateKey());
    if (!privateKey) {
      log("[NOSTR] Pending root publish found, but no private key is available");
      return null;
    }

    log(
      `[NOSTR] Retrying pending publish for ${pending.treeName} (${pending.rootHash.slice(0, 16)}...)`
    );
    const result = await attemptMerkleRootPublish(privateKey, pending);
    if (result.success) {
      log(
        `[NOSTR] Pending publish confirmed on ${result.confirmedRelays.length} relay(s)`
      );
    } else {
      log(
        `[NOSTR] Pending publish still waiting: accepted=${result.acceptedRelays.length} confirmed=${result.confirmedRelays.length} ${result.reason || ""}`
      );
    }
    return result;
  });
}
