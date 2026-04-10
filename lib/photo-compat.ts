import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { extractFileExtension, type PhotoEntry } from "./storage";
import { log } from "./logger";

const IRIS_WEB_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
]);

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export type NormalizedPhotoSource = {
  uri: string;
  extension: string;
  transformed: boolean;
  originalExtension: string;
};

function extensionFromMimeType(mimeType?: string | null): string | null {
  if (!mimeType) return null;
  return MIME_EXTENSION_MAP[mimeType.trim().toLowerCase()] || null;
}

export function resolvePhotoExtension(options?: {
  fileName?: string | null;
  mimeType?: string | null;
  uri?: string | null;
  fallback?: string;
}): string {
  const fallback = options?.fallback || "jpg";
  const fileNameExtension = extractFileExtension(options?.fileName || "", "");
  if (fileNameExtension) return fileNameExtension;

  const mimeTypeExtension = extensionFromMimeType(options?.mimeType);
  if (mimeTypeExtension) return mimeTypeExtension;

  const uriExtension = extractFileExtension(options?.uri || "", "");
  if (uriExtension) return uriExtension;

  return extractFileExtension(`photo.${fallback}`);
}

export function isIrisWebCompatibleImageExtension(
  extension?: string | null
): boolean {
  if (!extension) return false;
  return IRIS_WEB_IMAGE_EXTENSIONS.has(
    extractFileExtension(`photo.${extension}`, "")
  );
}

export function isIrisWebCompatiblePhotoEntry(entry: PhotoEntry): boolean {
  return isIrisWebCompatibleImageExtension(
    entry.cacheExtension || extractFileExtension(entry.name)
  );
}

export async function normalizePhotoUriForIris(options: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
}): Promise<NormalizedPhotoSource> {
  const originalExtension = resolvePhotoExtension({
    fileName: options.fileName,
    mimeType: options.mimeType,
    uri: options.uri,
  });

  if (isIrisWebCompatibleImageExtension(originalExtension)) {
    return {
      uri: options.uri,
      extension: originalExtension,
      transformed: false,
      originalExtension,
    };
  }

  const result = await manipulateAsync(options.uri, [], {
    compress: 1,
    format: SaveFormat.JPEG,
  });

  log(
    `[PHOTO] Normalized ${originalExtension.toUpperCase()} to JPG for Iris compatibility`
  );

  return {
    uri: result.uri,
    extension: "jpg",
    transformed: true,
    originalExtension,
  };
}
