import { Platform } from "react-native";
import { File } from "expo-file-system/next";
import * as MediaLibrary from "expo-media-library";
import * as ImagePicker from "expo-image-picker";
import { ingestPhotoBytes, publishPhotoRoot } from "./photo-sync";
import { log } from "./logger";
import { loadPhotoEntries } from "./storage";
import type { PublishMerkleRootResult } from "./nostr";

const IMPORT_PUBLISH_BATCH_SIZE = 10;
const IMPORT_PAGE_SIZE = 200;

export type ImportLibraryMode = "selected" | "all";
export type SelectedPhotoImportAsset = {
  uri: string;
  assetId?: string;
  fileName?: string;
  mimeType?: string;
  capturedAt?: number;
};

export type ImportLibraryPhase =
  | "checking-permissions"
  | "selecting"
  | "loading"
  | "importing"
  | "publishing"
  | "complete"
  | "cancelled"
  | "error";

export type ImportLibraryProgress = {
  phase: ImportLibraryPhase;
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  currentAssetName?: string;
  accessPrivileges?: "all" | "limited" | "none";
  message?: string;
};

export type ImportLibraryResult = {
  status: "completed" | "cancelled" | "denied" | "failed" | "unsupported";
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  accessPrivileges?: "all" | "limited" | "none";
  publishResult?: PublishMerkleRootResult | null;
  reason?: string;
};

function emitProgress(
  onProgress: ((progress: ImportLibraryProgress) => void) | undefined,
  progress: ImportLibraryProgress
): void {
  onProgress?.(progress);
}

function getCapturedAtFromExif(exif?: Record<string, any> | null): number | undefined {
  if (!exif) return undefined;

  const rawValue =
    exif.DateTimeOriginal ||
    exif.DateTimeDigitized ||
    exif.DateTime ||
    exif.CreationDate ||
    exif.creationDate;

  if (!rawValue) return undefined;
  if (typeof rawValue === "number") {
    return rawValue > 10_000_000_000 ? rawValue : rawValue * 1000;
  }
  if (typeof rawValue !== "string") return undefined;

  const normalized = rawValue
    .trim()
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
    .replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function resolveSelectedAssetUri(asset: SelectedPhotoImportAsset): Promise<string> {
  const directUri = asset.uri;
  try {
    const directFile = new File(directUri);
    if (directFile.exists) {
      return directUri;
    }
  } catch {}

  if (!asset.assetId) {
    throw new Error("Selected photo file is no longer available.");
  }

  const assetInfo = await MediaLibrary.getAssetInfoAsync(asset.assetId, {
    shouldDownloadFromNetwork: true,
  });
  if (!assetInfo.localUri) {
    throw new Error("Could not restore selected photo from the library.");
  }
  return assetInfo.localUri;
}

export async function importSelectedPhotoAssets(
  privateKey: Uint8Array,
  pickedAssets: SelectedPhotoImportAsset[],
  onProgress?: (progress: ImportLibraryProgress) => void
): Promise<ImportLibraryResult> {
  let processed = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let insertedSinceLastPublish = 0;
  let lastPublishResult: PublishMerkleRootResult | null = null;

  emitProgress(onProgress, {
    phase: "importing",
    total: pickedAssets.length,
    processed,
    imported,
    skipped,
    failed,
  });

  for (const asset of pickedAssets) {
    emitProgress(onProgress, {
      phase: "importing",
      total: pickedAssets.length,
      processed,
      imported,
      skipped,
      failed,
      currentAssetName: asset.fileName || asset.assetId || asset.uri,
    });

    try {
      const selectedUri = await resolveSelectedAssetUri(asset);
      const bytes = await new File(selectedUri).bytes();
      const ingestResult = await ingestPhotoBytes(privateKey, bytes, {
        capturedAt: asset.capturedAt || Date.now(),
        sourceAssetId: asset.assetId || undefined,
        extension: asset.fileName || asset.mimeType || selectedUri,
        publishToNostr: false,
      });

      if (ingestResult.duplicate) {
        skipped += 1;
      } else {
        imported += 1;
        insertedSinceLastPublish += 1;
      }

      processed += 1;

      if (!ingestResult.duplicate && !ingestResult.remoteSynced) {
        failed += 1;
        return {
          status: "failed",
          total: pickedAssets.length,
          processed,
          imported,
          skipped,
          failed,
          publishResult: lastPublishResult,
          reason: "A Blossom upload failed before the root could be published.",
        };
      }

      if (insertedSinceLastPublish >= IMPORT_PUBLISH_BATCH_SIZE) {
        emitProgress(onProgress, {
          phase: "publishing",
          total: pickedAssets.length,
          processed,
          imported,
          skipped,
          failed,
          currentAssetName: asset.fileName || asset.assetId || asset.uri,
        });

        lastPublishResult = await publishPhotoRoot(privateKey);
        insertedSinceLastPublish = 0;
      }
    } catch (error: any) {
      processed += 1;
      failed += 1;
      log("[IMPORT] Failed", asset.fileName || asset.assetId || asset.uri, error?.message || error);
    }
  }

  if (insertedSinceLastPublish > 0) {
    emitProgress(onProgress, {
      phase: "publishing",
      total: pickedAssets.length,
      processed,
      imported,
      skipped,
      failed,
    });

    lastPublishResult = await publishPhotoRoot(privateKey);
  }

  emitProgress(onProgress, {
    phase: "complete",
    total: pickedAssets.length,
    processed,
    imported,
    skipped,
    failed,
  });

  return {
    status: "completed",
    total: pickedAssets.length,
    processed,
    imported,
    skipped,
    failed,
    publishResult: lastPublishResult,
  };
}

export async function pickSelectedPhotosForImport(
  onProgress?: (progress: ImportLibraryProgress) => void
): Promise<SelectedPhotoImportAsset[] | null> {
  if (Platform.OS !== "ios") {
    return null;
  }

  emitProgress(onProgress, {
    phase: "selecting",
    total: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    message: "Choose photos, then tap Done.",
  });

  const pickerResult = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: true,
    selectionLimit: 0,
    orderedSelection: true,
    quality: 1,
    exif: true,
    legacy: false,
    ...(Platform.OS === "ios" ? { shouldDownloadFromNetwork: true as const } : {}),
  });

  if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
    return null;
  }

  return pickerResult.assets.map((asset) => ({
    uri: asset.uri,
    assetId: asset.assetId || undefined,
    fileName: asset.fileName || undefined,
    mimeType: asset.mimeType || undefined,
    capturedAt: getCapturedAtFromExif(asset.exif) || undefined,
  }));
}

export async function importSelectedPhotosFromPicker(
  privateKey: Uint8Array,
  onProgress?: (progress: ImportLibraryProgress) => void
): Promise<ImportLibraryResult> {
  const pickedAssets = await pickSelectedPhotosForImport(onProgress);
  if (!pickedAssets) {
    emitProgress(onProgress, {
      phase: "cancelled",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
    });

    return {
      status: "cancelled",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
    };
  }

  return await importSelectedPhotoAssets(privateKey, pickedAssets, onProgress);
}

async function loadAccessiblePhotoAssets(): Promise<MediaLibrary.Asset[]> {
  const assets: MediaLibrary.Asset[] = [];
  let after: string | undefined;
  let hasNextPage = true;

  while (hasNextPage) {
    const page = await MediaLibrary.getAssetsAsync({
      first: IMPORT_PAGE_SIZE,
      after,
      mediaType: [MediaLibrary.MediaType.photo],
      sortBy: [[MediaLibrary.SortBy.creationTime, true]],
    });

    assets.push(...page.assets);
    hasNextPage = page.hasNextPage;
    after = page.endCursor || undefined;
  }

  return assets;
}

export async function importPhotoLibrary(
  privateKey: Uint8Array,
  options?: {
    mode?: ImportLibraryMode;
    onProgress?: (progress: ImportLibraryProgress) => void;
  }
): Promise<ImportLibraryResult> {
  const mode = options?.mode || "all";
  const onProgress = options?.onProgress;

  if (Platform.OS !== "ios") {
    return {
      status: "unsupported",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      reason: "Photo library import is iOS-only for now.",
    };
  }

  emitProgress(onProgress, {
    phase: "checking-permissions",
    total: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
  });

  let permission = await MediaLibrary.getPermissionsAsync();

  if (!permission.granted) {
    permission = await MediaLibrary.requestPermissionsAsync();
  } else if (permission.accessPrivileges === "limited" && mode === "selected") {
    emitProgress(onProgress, {
      phase: "selecting",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      accessPrivileges: "limited",
      message: "Choose more photos to import.",
    });

    try {
      await MediaLibrary.presentPermissionsPickerAsync(["photo"]);
      permission = await MediaLibrary.getPermissionsAsync();
    } catch (error: any) {
      log("[IMPORT] Limited-library picker unavailable:", error?.message);
    }
  } else if (permission.accessPrivileges === "limited" && mode === "all") {
    permission = await MediaLibrary.requestPermissionsAsync();
    if (permission.accessPrivileges === "limited") {
      return {
        status: "failed",
        total: 0,
        processed: 0,
        imported: 0,
        skipped: 0,
        failed: 0,
        accessPrivileges: "limited",
        reason:
          "Photos access is still limited. To import your whole library, switch this app to All Photos in iPhone Settings.",
      };
    }
  } else if (permission.accessPrivileges === "limited") {
    permission = await MediaLibrary.getPermissionsAsync();
  }

  const accessPrivileges =
    permission.accessPrivileges || (permission.granted ? "all" : "none");

  if (!permission.granted) {
    emitProgress(onProgress, {
      phase: "cancelled",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      accessPrivileges,
    });

    return {
      status: permission.canAskAgain ? "cancelled" : "denied",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      accessPrivileges,
      reason: "Photo library access was not granted.",
    };
  }

  emitProgress(onProgress, {
    phase: "loading",
    total: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    accessPrivileges,
    message: "Loading your photo library…",
  });

  const allAssets = await loadAccessiblePhotoAssets();
  const importedAssetIds = new Set(
    loadPhotoEntries()
      .map((entry) => entry.sourceAssetId)
      .filter((assetId): assetId is string => Boolean(assetId))
  );
  const assetsToImport = allAssets.filter((asset) => !importedAssetIds.has(asset.id));

  let processed = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let insertedSinceLastPublish = 0;
  let lastPublishResult: PublishMerkleRootResult | null = null;
  let failureReason: string | undefined;

  emitProgress(onProgress, {
    phase: "importing",
    total: assetsToImport.length,
    processed,
    imported,
    skipped,
    failed,
    accessPrivileges,
  });

  for (const asset of assetsToImport) {
    emitProgress(onProgress, {
      phase: "importing",
      total: assetsToImport.length,
      processed,
      imported,
      skipped,
      failed,
      currentAssetName: asset.filename,
      accessPrivileges,
    });

    try {
      const assetInfo = await MediaLibrary.getAssetInfoAsync(asset, {
        shouldDownloadFromNetwork: true,
      });
      const localUri = assetInfo.localUri;

      if (!localUri) {
        throw new Error("No local URI returned for this asset");
      }

      const bytes = await new File(localUri).bytes();
      const ingestResult = await ingestPhotoBytes(privateKey, bytes, {
        capturedAt: asset.creationTime || assetInfo.creationTime || Date.now(),
        sourceAssetId: asset.id,
        extension: asset.filename || localUri,
        publishToNostr: false,
      });

      if (ingestResult.duplicate) {
        skipped += 1;
      } else {
        imported += 1;
        insertedSinceLastPublish += 1;
      }

      processed += 1;

      if (!ingestResult.duplicate && !ingestResult.remoteSynced) {
        failed += 1;
        failureReason = "A Blossom upload failed before the root could be published.";
        break;
      }

      if (insertedSinceLastPublish >= IMPORT_PUBLISH_BATCH_SIZE) {
        emitProgress(onProgress, {
          phase: "publishing",
          total: assetsToImport.length,
          processed,
          imported,
          skipped,
          failed,
          currentAssetName: asset.filename,
          accessPrivileges,
        });

        lastPublishResult = await publishPhotoRoot(privateKey);
        insertedSinceLastPublish = 0;
      }
    } catch (error: any) {
      processed += 1;
      failed += 1;
      log("[IMPORT] Failed", asset.filename, error?.message || error);
    }
  }

  if (!failureReason && insertedSinceLastPublish > 0) {
    emitProgress(onProgress, {
      phase: "publishing",
      total: assetsToImport.length,
      processed,
      imported,
      skipped,
      failed,
      accessPrivileges,
    });

    lastPublishResult = await publishPhotoRoot(privateKey);
  }

  if (failureReason) {
    emitProgress(onProgress, {
      phase: "error",
      total: assetsToImport.length,
      processed,
      imported,
      skipped,
      failed,
      accessPrivileges,
      message: failureReason,
    });

    return {
      status: "failed",
      total: assetsToImport.length,
      processed,
      imported,
      skipped,
      failed,
      accessPrivileges,
      publishResult: lastPublishResult,
      reason: failureReason,
    };
  }

  emitProgress(onProgress, {
    phase: "complete",
    total: assetsToImport.length,
    processed,
    imported,
    skipped,
    failed,
    accessPrivileges,
  });

  return {
    status: "completed",
    total: assetsToImport.length,
    processed,
    imported,
    skipped,
    failed,
    accessPrivileges,
    publishResult: lastPublishResult,
  };
}
