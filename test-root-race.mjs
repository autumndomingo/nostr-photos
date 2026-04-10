/**
 * Regression test for the camera background upload race.
 *
 * Two photo jobs that both read the same saved root can overwrite each other,
 * leaving only the last-completed root. Serializing the jobs preserves both.
 */
import { HashTree, MemoryStore, LinkType, cid, fromHex, toHex } from "@hashtree/core";

function createRootState() {
  let savedRoot = null;

  return {
    load() {
      if (!savedRoot) return null;
      return cid(
        fromHex(savedRoot.hash),
        savedRoot.key ? fromHex(savedRoot.key) : undefined
      );
    },
    save(rootCid) {
      savedRoot = {
        hash: toHex(rootCid.hash),
        key: rootCid.key ? toHex(rootCid.key) : undefined,
      };
    },
  };
}

async function addPhoto(tree, rootState, fileName, delayMs) {
  const currentRoot = rootState.load();
  const bytes = new TextEncoder().encode(`${fileName}:${Date.now()}`);
  const { cid: fileCid, size } = await tree.putFile(bytes);

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  let rootCid;
  if (currentRoot) {
    rootCid = await tree.setEntry(currentRoot, [], fileName, fileCid, size, LinkType.File);
  } else {
    const { cid: dirCid } = await tree.putDirectory([
      { name: fileName, cid: fileCid, size, type: LinkType.File },
    ]);
    rootCid = dirCid;
  }

  rootState.save(rootCid);
  return rootCid;
}

async function listNames(tree, rootState) {
  const rootCid = rootState.load();
  if (!rootCid) return [];
  const entries = await tree.listDirectory(rootCid);
  return entries.map((entry) => entry.name).sort();
}

async function runConcurrentScenario() {
  const tree = new HashTree({ store: new MemoryStore() });
  const rootState = createRootState();

  await Promise.all([
    addPhoto(tree, rootState, "photo-a.jpg", 50),
    addPhoto(tree, rootState, "photo-b.jpg", 10),
  ]);

  return listNames(tree, rootState);
}

async function runQueuedScenario() {
  const tree = new HashTree({ store: new MemoryStore() });
  const rootState = createRootState();

  let queue = Promise.resolve();
  const enqueue = (fileName, delayMs) => {
    queue = queue.then(() => addPhoto(tree, rootState, fileName, delayMs));
    return queue;
  };

  await Promise.all([
    enqueue("photo-a.jpg", 50),
    enqueue("photo-b.jpg", 10),
  ]);

  return listNames(tree, rootState);
}

const concurrentNames = await runConcurrentScenario();
console.log("Concurrent result:", concurrentNames.join(", "));
if (concurrentNames.length !== 1) {
  throw new Error(`Expected race to drop to 1 photo, got ${concurrentNames.length}`);
}

const queuedNames = await runQueuedScenario();
console.log("Queued result:", queuedNames.join(", "));
if (queuedNames.length !== 2) {
  throw new Error(`Expected queue to preserve 2 photos, got ${queuedNames.length}`);
}

console.log("PASS");
