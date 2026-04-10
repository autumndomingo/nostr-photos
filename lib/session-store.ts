import {
  deletePrivateKey,
  getNpub,
  loadPrivateKey,
  savePrivateKey,
} from "./nostr";

export type SessionSnapshot = {
  resolved: boolean;
  privateKey: Uint8Array | null;
  npub: string | null;
};

let currentSnapshot: SessionSnapshot = {
  resolved: false,
  privateKey: null,
  npub: null,
};

let currentLoadPromise: Promise<SessionSnapshot> | null = null;
const listeners = new Set<(snapshot: SessionSnapshot) => void>();

function emitSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  currentSnapshot = snapshot;
  for (const listener of listeners) {
    listener(currentSnapshot);
  }
  return currentSnapshot;
}

function buildSnapshot(privateKey: Uint8Array | null): SessionSnapshot {
  return {
    resolved: true,
    privateKey,
    npub: privateKey ? getNpub(privateKey) : null,
  };
}

export function getSessionSnapshot(): SessionSnapshot {
  return currentSnapshot;
}

export function subscribeToSession(
  listener: (snapshot: SessionSnapshot) => void
): () => void {
  listeners.add(listener);
  listener(currentSnapshot);
  return () => {
    listeners.delete(listener);
  };
}

export async function ensureSessionLoaded(): Promise<SessionSnapshot> {
  if (currentSnapshot.resolved) {
    return currentSnapshot;
  }

  if (currentLoadPromise) {
    return await currentLoadPromise;
  }

  currentLoadPromise = loadPrivateKey()
    .then((privateKey) => emitSnapshot(buildSnapshot(privateKey)))
    .finally(() => {
      currentLoadPromise = null;
    });

  return await currentLoadPromise;
}

export async function saveSessionPrivateKey(
  privateKey: Uint8Array
): Promise<SessionSnapshot> {
  await savePrivateKey(privateKey);
  return emitSnapshot(buildSnapshot(privateKey));
}

export async function clearSessionPrivateKey(): Promise<SessionSnapshot> {
  await deletePrivateKey();
  return emitSnapshot(buildSnapshot(null));
}
