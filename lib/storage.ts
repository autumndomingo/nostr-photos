import { File, Paths, Directory } from "expo-file-system/next";
import { toHex, type CID } from "@hashtree/core";

export type PhotoEntry = {
  name: string;
  cidHash: string;
  cidKey?: string;
  size: number;
  timestamp: number;
  capturedAt?: number;
  sequence?: number;
  sourceAssetId?: string;
  cacheExtension?: string;
};

const PHOTOS_DIR = new Directory(Paths.document, "photos");
const PHOTO_DB_FILE = new File(Paths.document, "photos.json");
const SEQUENTIAL_PHOTO_NAME_RE = /^photo_(\d{6,})\.[a-z0-9]+$/i;

export function initStorage(): void {
  if (!PHOTOS_DIR.exists) {
    PHOTOS_DIR.create({ intermediates: true });
  }
}

function normalizeCacheExtension(extension?: string): string {
  const cleaned = (extension || "jpg").trim().replace(/^\./, "").toLowerCase();
  return cleaned || "jpg";
}

function getEntryCapturedAt(entry: PhotoEntry): number {
  return typeof entry.capturedAt === "number" ? entry.capturedAt : entry.timestamp;
}

function sortPhotoEntries(entries: PhotoEntry[]): PhotoEntry[] {
  return [...entries].sort((a, b) => {
    const capturedDiff = getEntryCapturedAt(b) - getEntryCapturedAt(a);
    if (capturedDiff !== 0) return capturedDiff;

    const sequenceDiff = (b.sequence || 0) - (a.sequence || 0);
    if (sequenceDiff !== 0) return sequenceDiff;

    const timestampDiff = b.timestamp - a.timestamp;
    if (timestampDiff !== 0) return timestampDiff;

    return b.name.localeCompare(a.name);
  });
}

export function extractFileExtension(pathLike?: string | null, fallback = "jpg"): string {
  if (!pathLike) return normalizeCacheExtension(fallback);

  const withoutQuery = pathLike.split("?")[0];
  const match = /\.([a-zA-Z0-9]+)$/.exec(withoutQuery);
  if (!match) return normalizeCacheExtension(fallback);

  return normalizeCacheExtension(match[1]);
}

export function parsePhotoSequence(name?: string): number | undefined {
  if (!name) return undefined;
  const match = SEQUENTIAL_PHOTO_NAME_RE.exec(name);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizePhotoEntry(raw: any): PhotoEntry | null {
  if (!raw || typeof raw.cidHash !== "string" || raw.cidHash.length === 0) {
    return null;
  }

  const timestamp = typeof raw.timestamp === "number" ? raw.timestamp : Date.now();
  const capturedAt =
    typeof raw.capturedAt === "number" ? raw.capturedAt : timestamp;
  const name =
    typeof raw.name === "string" && raw.name.length > 0
      ? raw.name
      : buildSequentialPhotoFileName(
          parsePhotoSequence(raw.name) || 1,
          extractFileExtension(raw.name)
        );

  return {
    name,
    cidHash: raw.cidHash,
    cidKey: typeof raw.cidKey === "string" ? raw.cidKey : undefined,
    size: typeof raw.size === "number" ? raw.size : 0,
    timestamp,
    capturedAt,
    sequence:
      typeof raw.sequence === "number"
        ? raw.sequence
        : parsePhotoSequence(name),
    sourceAssetId:
      typeof raw.sourceAssetId === "string" && raw.sourceAssetId.length > 0
        ? raw.sourceAssetId
        : undefined,
    cacheExtension: normalizeCacheExtension(
      raw.cacheExtension || extractFileExtension(name)
    ),
  };
}

export function loadPhotoEntries(): PhotoEntry[] {
  if (!PHOTO_DB_FILE.exists) return [];
  try {
    const text = PHOTO_DB_FILE.textSync();
    const raw = JSON.parse(text) as any[];
    return sortPhotoEntries(
      raw
        .map(normalizePhotoEntry)
        .filter((entry): entry is PhotoEntry => entry !== null)
    );
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
  PHOTO_DB_FILE.write(JSON.stringify(sortPhotoEntries(entries)));
}

export function replacePhotoEntries(entries: PhotoEntry[]): void {
  savePhotoEntries(entries);
}

export function buildSequentialPhotoFileName(
  sequence: number,
  extension = "jpg"
): string {
  const safeSequence = Math.max(1, Math.floor(sequence));
  const safeExtension = normalizeCacheExtension(extension);
  return `photo_${String(safeSequence).padStart(6, "0")}.${safeExtension}`;
}

export function getNextPhotoSequence(entries: PhotoEntry[] = loadPhotoEntries()): number {
  const maxSequence = entries.reduce((max, entry) => {
    const parsed = entry.sequence || parsePhotoSequence(entry.name) || 0;
    return Math.max(max, parsed);
  }, 0);
  return Math.max(entries.length, maxSequence) + 1;
}

export function hasLegacyPhotoNames(entries: PhotoEntry[] = loadPhotoEntries()): boolean {
  const chronological = [...entries].sort((a, b) => {
    const capturedDiff = getEntryCapturedAt(a) - getEntryCapturedAt(b);
    if (capturedDiff !== 0) return capturedDiff;
    return a.timestamp - b.timestamp;
  });

  return chronological.some((entry, index) => {
    const sequence = index + 1;
    const extension = entry.cacheExtension || extractFileExtension(entry.name);
    const expectedName = buildSequentialPhotoFileName(sequence, extension);
    return entry.sequence !== sequence || entry.name !== expectedName;
  });
}

export function findPhotoEntryByAssetId(
  sourceAssetId: string,
  entries: PhotoEntry[] = loadPhotoEntries()
): PhotoEntry | undefined {
  return entries.find((entry) => entry.sourceAssetId === sourceAssetId);
}

export function attachSourceAssetIdToPhotoEntry(
  cidHash: string,
  sourceAssetId: string
): void {
  const entries = loadPhotoEntries();
  const index = entries.findIndex((entry) => entry.cidHash === cidHash);
  if (index === -1) return;
  if (entries[index].sourceAssetId === sourceAssetId) return;

  entries[index] = {
    ...entries[index],
    sourceAssetId,
  };
  savePhotoEntries(entries);
}

export function addPhotoEntry(
  name: string,
  fileCid: CID,
  size: number,
  options?: {
    capturedAt?: number;
    sequence?: number;
    sourceAssetId?: string;
    cacheExtension?: string;
  }
): PhotoEntry {
  const entries = loadPhotoEntries();
  const cidHash = toHex(fileCid.hash);
  const existingIndex = entries.findIndex((entry) => entry.cidHash === cidHash);

  if (existingIndex !== -1) {
    const existing = entries[existingIndex];
    const updated: PhotoEntry = {
      ...existing,
      sourceAssetId: existing.sourceAssetId || options?.sourceAssetId,
      capturedAt: existing.capturedAt || options?.capturedAt,
      cacheExtension:
        existing.cacheExtension ||
        normalizeCacheExtension(options?.cacheExtension || extractFileExtension(name)),
      sequence: existing.sequence || options?.sequence || parsePhotoSequence(name),
    };

    entries[existingIndex] = updated;
    savePhotoEntries(entries);
    return updated;
  }

  const entry: PhotoEntry = {
    name,
    cidHash,
    cidKey: fileCid.key ? toHex(fileCid.key) : undefined,
    size,
    timestamp: Date.now(),
    capturedAt: options?.capturedAt ?? Date.now(),
    sequence: options?.sequence ?? parsePhotoSequence(name),
    sourceAssetId: options?.sourceAssetId,
    cacheExtension: normalizeCacheExtension(
      options?.cacheExtension || extractFileExtension(name)
    ),
  };

  entries.push(entry);

  savePhotoEntries(entries);
  return entry;
}

// Get local cache path for a photo
export function getLocalCachePath(cidHash: string, extension = "jpg"): File {
  initStorage();
  return new File(PHOTOS_DIR, `${cidHash}.${normalizeCacheExtension(extension)}`);
}

export function getLocalCachePathForEntry(entry: PhotoEntry): File {
  return getLocalCachePath(
    entry.cidHash,
    entry.cacheExtension || extractFileExtension(entry.name)
  );
}

export function isPhotoCached(cidHash: string, extension = "jpg"): boolean {
  return getLocalCachePath(cidHash, extension).exists;
}

// Reconstruct a CID from stored hex strings
export function entryToCid(entry: PhotoEntry): CID {
  const { fromHex, cid } = require("@hashtree/core");
  return cid(
    fromHex(entry.cidHash),
    entry.cidKey ? fromHex(entry.cidKey) : undefined
  );
}
