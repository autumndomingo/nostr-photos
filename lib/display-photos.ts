import {
  getPhotoDisplayUri,
  type PhotoEntry,
} from "./storage";
import { type PendingCapturedPhoto } from "./photo-ingest-manager";

export type DisplayPhoto = {
  key: string;
  uri: string;
  capturedAt: number;
  pending: boolean;
  photo: PhotoEntry | null;
};

function getCapturedAt(entry: PhotoEntry): number {
  return entry.capturedAt ?? entry.timestamp;
}

export function buildDisplayPhotos(
  entries: PhotoEntry[],
  pendingPhotos: PendingCapturedPhoto[]
): DisplayPhoto[] {
  const storedEntries = entries.map((entry) => ({
    key: `stored:${entry.cidHash}`,
    uri: getPhotoDisplayUri(entry),
    capturedAt: getCapturedAt(entry),
    pending: false,
    photo: entry,
  }));

  const storedCapturedAt = new Set(storedEntries.map((entry) => entry.capturedAt));
  const pendingEntries = pendingPhotos
    .filter((pending) => !storedCapturedAt.has(pending.capturedAt))
    .map((pending) => ({
      key: `pending:${pending.key}`,
      uri: pending.uri,
      capturedAt: pending.capturedAt,
      pending: true,
      photo: null,
    }));

  return [...storedEntries, ...pendingEntries].sort((a, b) => {
    const capturedDiff = b.capturedAt - a.capturedAt;
    if (capturedDiff !== 0) return capturedDiff;
    if (a.pending !== b.pending) return a.pending ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
}
