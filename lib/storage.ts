import { File, Paths, Directory } from "expo-file-system/next";
import { toHex, type CID } from "@hashtree/core";

export type PhotoEntry = {
  name: string;
  cidHash: string;
  cidKey?: string;
  size: number;
  timestamp: number;
};

const PHOTOS_DIR = new Directory(Paths.document, "photos");
const PHOTO_DB_FILE = new File(Paths.document, "photos.json");

export function initStorage(): void {
  if (!PHOTOS_DIR.exists) {
    PHOTOS_DIR.create({ intermediates: true });
  }
}

export function loadPhotoEntries(): PhotoEntry[] {
  if (!PHOTO_DB_FILE.exists) return [];
  try {
    const text = PHOTO_DB_FILE.textSync();
    const raw = JSON.parse(text) as any[];
    // Only return valid entries with cidHash
    return raw.filter((e) => e.cidHash && e.cidHash.length > 0);
  } catch {
    return [];
  }
}

// Wipe all local data and start fresh
export function clearAllData(): void {
  if (PHOTO_DB_FILE.exists) PHOTO_DB_FILE.delete();
  if (PHOTOS_DIR.exists) PHOTOS_DIR.delete();
}

function savePhotoEntries(entries: PhotoEntry[]): void {
  PHOTO_DB_FILE.write(JSON.stringify(entries));
}

export function addPhotoEntry(
  name: string,
  fileCid: CID,
  size: number
): void {
  const entries = loadPhotoEntries();
  const cidHash = toHex(fileCid.hash);

  // Don't add duplicates
  if (entries.some((e) => e.cidHash === cidHash)) return;

  entries.unshift({
    name,
    cidHash,
    cidKey: fileCid.key ? toHex(fileCid.key) : undefined,
    size,
    timestamp: Date.now(),
  });

  savePhotoEntries(entries);
}

// Get local cache path for a photo
export function getLocalCachePath(cidHash: string): File {
  initStorage();
  return new File(PHOTOS_DIR, `${cidHash}.jpg`);
}

export function isPhotoCached(cidHash: string): boolean {
  return getLocalCachePath(cidHash).exists;
}

// Reconstruct a CID from stored hex strings
export function entryToCid(entry: PhotoEntry): CID {
  const { fromHex, cid } = require("@hashtree/core");
  return cid(
    fromHex(entry.cidHash),
    entry.cidKey ? fromHex(entry.cidKey) : undefined
  );
}
