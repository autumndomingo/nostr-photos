import {
  BlossomStore,
  FallbackStore,
  HashTree,
  LinkType,
  MemoryStore,
  toHex,
  type CID,
} from "@hashtree/core";
import { finalizeEvent } from "nostr-tools/pure";
import { getNpub, publishMerkleRoot, type PublishMerkleRootResult } from "./nostr";
import { log } from "./logger";

const BLOSSOM_SERVERS = [
  { url: "https://upload.iris.to", read: true, write: true },
  { url: "https://cdn.iris.to", read: true, write: false },
  { url: "https://blossom.primal.net", read: true, write: true },
];

export type PhotoE2ETestResult = {
  treeName: string;
  npub: string;
  url: string;
  rootHash: string;
  entryNames: string[];
  publishResult: PublishMerkleRootResult;
};

export async function runPhotoLibraryE2ETest(
  privateKey: Uint8Array
): Promise<PhotoE2ETestResult> {
  const treeName = `photos-e2e-${Date.now()}`;
  const signer = async (draft: any) =>
    finalizeEvent(
      {
        kind: draft.kind,
        created_at: draft.created_at,
        content: draft.content,
        tags: draft.tags,
      },
      privateKey
    ) as any;

  const blossomStore = new BlossomStore({
    servers: BLOSSOM_SERVERS,
    signer,
  });
  const tree = new HashTree({
    store: new FallbackStore({
      primary: new MemoryStore(),
      fallbacks: [blossomStore],
    }),
  });

  const addEntry = async (rootCid: CID | null, name: string, bytes: Uint8Array) => {
    const { cid: fileCid, size } = await tree.putFile(bytes);

    if (rootCid) {
      return await tree.setEntry(rootCid, [], name, fileCid, size, LinkType.File);
    }

    return (
      await tree.putDirectory([{ name, cid: fileCid, size, type: LinkType.File }])
    ).cid;
  };

  let rootCid: CID | null = null;
  let finalPublishResult: PublishMerkleRootResult | null = null;

  for (let index = 1; index <= 2; index++) {
    const fileName = `e2e_photo_${index}.jpg`;
    const bytes = new TextEncoder().encode(`On-device E2E photo ${index} ${Date.now()}`);
    rootCid = await addEntry(rootCid, fileName, bytes);

    const push = await tree.push(rootCid, blossomStore, { concurrency: 2 });
    if (push.failed > 0) {
      throw new Error(
        `E2E push failed for ${fileName}: ${push.errors.map((entry) => entry.error.message).join("; ")}`
      );
    }

    finalPublishResult = await publishMerkleRoot(
      privateKey,
      toHex(rootCid.hash),
      index,
      rootCid.key ? toHex(rootCid.key) : undefined,
      { treeName }
    );
  }

  if (!rootCid || !finalPublishResult) {
    throw new Error("E2E test did not produce a final root");
  }

  const remoteTree = new HashTree({ store: blossomStore });
  const entries = await remoteTree.listDirectory(rootCid);
  const entryNames = entries.map((entry) => entry.name).sort();
  const npub = getNpub(privateKey);
  const result = {
    treeName,
    npub,
    url: `https://files.iris.to/#/${npub}/${treeName}`,
    rootHash: toHex(rootCid.hash),
    entryNames,
    publishResult: finalPublishResult,
  };

  log(
    "[E2E] Tree:",
    treeName,
    "Entries:",
    entryNames.join(", "),
    "Confirmed:",
    finalPublishResult.confirmedRelays.length
  );

  return result;
}
