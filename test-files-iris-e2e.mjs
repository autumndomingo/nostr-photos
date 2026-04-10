/**
 * End-to-end publisher for files.iris.to verification.
 *
 * Publishes a private "photos" tree with two files using a disposable nsec,
 * writes the resulting credentials + URL to /tmp/iris-files-e2e.json,
 * and verifies the final root is readable back from Blossom.
 */
import {
  BlossomStore,
  FallbackStore,
  HashTree,
  LinkType,
  MemoryStore,
  toHex,
} from "@hashtree/core";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { nsecEncode, npubEncode } from "nostr-tools/nip19";
import * as nip44 from "nostr-tools/nip44";
import fs from "node:fs";

const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://temp.iris.to",
  "wss://relay.snort.social",
];

const BLOSSOM_SERVERS = [
  { url: "https://upload.iris.to", read: true, write: true },
  { url: "https://cdn.iris.to", read: true, write: false },
  { url: "https://blossom.primal.net", read: true, write: true },
];

const OUTPUT_FILE = "/tmp/iris-files-e2e.json";

function createSigner(privateKey) {
  return async (draft) =>
    finalizeEvent(
      {
        kind: draft.kind,
        created_at: draft.created_at,
        content: draft.content,
        tags: draft.tags,
      },
      privateKey
    );
}

async function publishToRelay(relay, event) {
  return await new Promise((resolve) => {
    const ws = new WebSocket(relay);
    let settled = false;

    const done = (ok, info) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      resolve({ relay, ok, info, eventId: event.id, createdAt: event.created_at });
    };

    const timeout = setTimeout(() => done(false, "timeout"), 7000);

    ws.onopen = () => {
      ws.send(JSON.stringify(["EVENT", event]));
    };

    ws.onmessage = (message) => {
      try {
        const data = JSON.parse(String(message.data));
        if (Array.isArray(data) && data[0] === "OK" && data[1] === event.id) {
          clearTimeout(timeout);
          done(Boolean(data[2]), data[3] ?? "");
        }
      } catch {}
    };

    ws.onerror = () => {
      clearTimeout(timeout);
      done(false, "socket error");
    };
  });
}

async function main() {
  const privateKey = generateSecretKey();
  const pubkeyHex = getPublicKey(privateKey);
  const npub = npubEncode(pubkeyHex);
  const nsec = nsecEncode(privateKey);

  const blossomStore = new BlossomStore({
    servers: BLOSSOM_SERVERS,
    signer: createSigner(privateKey),
  });
  const localStore = new MemoryStore();
  const store = new FallbackStore({
    primary: localStore,
    fallbacks: [blossomStore],
  });
  const tree = new HashTree({ store });

  async function addPhoto(rootCid, name, content) {
    const bytes = new TextEncoder().encode(content);
    const { cid: fileCid, size } = await tree.putFile(bytes);

    if (rootCid) {
      rootCid = await tree.setEntry(rootCid, [], name, fileCid, size, LinkType.File);
    } else {
      rootCid = (
        await tree.putDirectory([{ name, cid: fileCid, size, type: LinkType.File }])
      ).cid;
    }

    const push = await tree.push(rootCid, blossomStore, { concurrency: 4 });
    if (push.failed > 0) {
      throw new Error(
        `Push failed for ${name}: ${push.errors.map((entry) => entry.error.message).join("; ")}`
      );
    }

    return rootCid;
  }

  async function verifyRemote(rootCid, expectedCount) {
    const remoteTree = new HashTree({ store: blossomStore });
    const entries = await remoteTree.listDirectory(rootCid);
    const entryNames = entries.map((entry) => entry.name).sort();
    if (entryNames.length !== expectedCount) {
      throw new Error(`Expected ${expectedCount} remote entries, got ${entryNames.length}`);
    }
    return entryNames;
  }

  async function publishRoot(rootCid, createdAt) {
    const rootHash = toHex(rootCid.hash);
    const rootKeyHex = rootCid.key ? toHex(rootCid.key) : undefined;
    if (!rootKeyHex) {
      throw new Error("Expected encrypted root CID key");
    }

    const conversationKey = nip44.v2.utils.getConversationKey(privateKey, pubkeyHex);
    const selfEncryptedKey = nip44.v2.encrypt(rootKeyHex, conversationKey);

    const relayResults = [];
    let nextCreatedAt = createdAt;
    for (const relay of RELAYS) {
      const event = finalizeEvent(
        {
          kind: 30078,
          created_at: nextCreatedAt,
          content: "",
          tags: [
            ["d", "photos"],
            ["l", "hashtree"],
            ["hash", rootHash],
            ["selfEncryptedKey", selfEncryptedKey],
          ],
        },
        privateKey
      );
      relayResults.push(await publishToRelay(relay, event));
      nextCreatedAt += 1;
    }

    return {
      rootHash,
      rootKeyHex,
      relayResults,
      nextCreatedAt,
    };
  }

  let createdAt = Math.floor(Date.now() / 1000);
  let rootCid = null;
  const publishes = [];

  rootCid = await addPhoto(rootCid, "photo_1.jpg", `Photo 1 ${Date.now()}`);
  const firstNames = await verifyRemote(rootCid, 1);
  const firstPublish = await publishRoot(rootCid, createdAt);
  createdAt = firstPublish.nextCreatedAt;
  publishes.push({
    step: 1,
    entryNames: firstNames,
    rootHash: firstPublish.rootHash,
    rootKeyHex: firstPublish.rootKeyHex,
    relays: firstPublish.relayResults,
    okRelays: firstPublish.relayResults.filter((result) => result.ok).map((result) => result.relay),
  });

  rootCid = await addPhoto(rootCid, "photo_2.jpg", `Photo 2 ${Date.now()}`);
  const secondNames = await verifyRemote(rootCid, 2);
  const secondPublish = await publishRoot(rootCid, createdAt);
  publishes.push({
    step: 2,
    entryNames: secondNames,
    rootHash: secondPublish.rootHash,
    rootKeyHex: secondPublish.rootKeyHex,
    relays: secondPublish.relayResults,
    okRelays: secondPublish.relayResults.filter((result) => result.ok).map((result) => result.relay),
  });

  const output = {
    npub,
    nsec,
    pubkeyHex,
    finalRootHash: secondPublish.rootHash,
    finalRootKeyHex: secondPublish.rootKeyHex,
    finalEntryNames: secondNames,
    url: `https://files.iris.to/#/${npub}/photos`,
    publishes,
    publishedAt: new Date().toISOString(),
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
