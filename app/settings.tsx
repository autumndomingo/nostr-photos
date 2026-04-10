import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { loadPrivateKey, deletePrivateKey, getNpub } from "../lib/nostr";
import { clearAllData } from "../lib/storage";
import {
  importPhotoLibrary,
  type ImportLibraryProgress,
} from "../lib/photo-library-import";
import { ensureSequentialPhotoLibrary } from "../lib/photo-sync";

export default function SettingsScreen() {
  const router = useRouter();
  const [npub, setNpub] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportLibraryProgress | null>(null);

  useEffect(() => {
    loadPrivateKey().then((key) => {
      if (key) {
        setNpub(getNpub(key));
      }
      setLoading(false);
    });
  }, []);

  async function handleCopyNpub() {
    if (!npub) return;
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(npub);
      } else {
        const Clipboard = await import("expo-clipboard");
        await Clipboard.setStringAsync(npub);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      Alert.alert("Copy", npub);
    }
  }

  function handleLogout() {
    Alert.alert("Log Out", "This will delete your key from this device.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          await deletePrivateKey();
          router.replace("/");
        },
      },
    ]);
  }

  async function handleImportLibrary() {
    if (importing) return;

    if (Platform.OS !== "ios") {
      Alert.alert("Unavailable", "Library import is iPhone-only for now.");
      return;
    }

    const privateKey = await loadPrivateKey();
    if (!privateKey) {
      Alert.alert("No Account", "Log in again before importing your library.");
      return;
    }

    setImporting(true);
    setImportProgress({
      phase: "checking-permissions",
      total: 0,
      processed: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
    });

    try {
      await ensureSequentialPhotoLibrary(privateKey);

      const result = await importPhotoLibrary(privateKey, setImportProgress);

      if (result.status === "unsupported") {
        Alert.alert("Unavailable", result.reason || "Library import is unavailable.");
      } else if (result.status === "denied") {
        Alert.alert(
          "Photo Access Needed",
          "Enable Photos access in Settings to import your library.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => Linking.openSettings(),
            },
          ]
        );
      } else if (result.status === "failed") {
        Alert.alert(
          "Import Stopped",
          result.reason ||
            `Imported ${result.imported} photos, skipped ${result.skipped}, failed ${result.failed}.`
        );
      } else if (result.status === "completed") {
        const publishMessage = result.publishResult?.success
          ? "Latest root confirmed on Nostr."
          : "Latest root is queued for retry if relay confirmation lags.";

        Alert.alert(
          "Import Complete",
          `Imported ${result.imported} photos, skipped ${result.skipped}, failed ${result.failed}.\n\n${publishMessage}`
        );
      }
    } catch (error: any) {
      Alert.alert("Import Failed", error?.message || "Could not import your photo library.");
      setImportProgress((current) =>
        current
          ? {
              ...current,
              phase: "error",
              message: error?.message || "Could not import your photo library.",
            }
          : null
      );
    } finally {
      setImporting(false);
    }
  }

  const totalToProcess = importProgress?.total || 0;
  const progressRatio =
    totalToProcess > 0
      ? importProgress!.processed / totalToProcess
      : importProgress && importing
        ? 0.12
        : 0;
  const progressWidth = `${Math.max(progressRatio * 100, importing ? 12 : 0)}%` as const;
  const progressLabel = importProgress
    ? importProgress.phase === "checking-permissions"
      ? "Waiting for Photos access"
      : importProgress.phase === "selecting"
        ? "Choose photos to import"
        : importProgress.phase === "loading"
          ? "Loading your photo library"
          : importProgress.phase === "publishing"
            ? `Publishing ${importProgress.processed}/${Math.max(importProgress.total, 1)}`
            : importProgress.phase === "complete"
              ? `Imported ${importProgress.imported}/${importProgress.total}`
              : importProgress.phase === "error"
                ? importProgress.message || "Import failed"
                : `Importing ${importProgress.processed}/${Math.max(importProgress.total, 1)} photos`
    : null;

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#7B2FF2" />
      </View>
    );
  }

  if (!npub) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No account found.</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace("/")}
        >
          <Text style={styles.buttonText}>Go to Welcome</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Public Key</Text>
        <TouchableOpacity style={styles.npubRow} onPress={handleCopyNpub}>
          <Text style={styles.npub} numberOfLines={1} ellipsizeMode="middle">
            {npub}
          </Text>
          <Text style={styles.copyIcon}>{copied ? "✓" : "⧉"}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          Share with friends so they can send you photos
        </Text>
        <Text style={styles.syncHint}>
          Photo roots publish to Nostr automatically. If relay confirmation fails,
          the app keeps the latest root queued and retries on the next launch.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Library Import</Text>
        <TouchableOpacity
          style={[styles.importButton, importing && styles.importButtonDisabled]}
          onPress={handleImportLibrary}
          disabled={importing}
        >
          <Text style={styles.importButtonText}>
            {importing ? "Importing Library…" : "Import My Library"}
          </Text>
        </TouchableOpacity>
        <Text style={styles.syncHint}>
          On iPhone, this imports selected or full Photos library access using the
          system picker, uploads each photo to Blossom, and publishes the updated
          photo root to Nostr in batches.
        </Text>
      </View>

      <View style={styles.spacer} />

      <TouchableOpacity
        style={styles.clearButton}
        onPress={() => {
          Alert.alert("Clear Photos", "Delete all local photo data?", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Clear",
              style: "destructive",
              onPress: () => {
                clearAllData();
                Alert.alert("Done", "Photo data cleared.");
              },
            },
          ]);
        }}
      >
        <Text style={styles.clearText}>Clear Photo Data</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      {importProgress ? (
        <View style={styles.progressDock}>
          <Text style={styles.progressTitle}>{progressLabel}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.progressMeta}>
            {totalToProcess > 0
              ? `${importProgress.processed}/${totalToProcess} photos`
              : importProgress.message || "Preparing import"}
            {" · "}
            imported {importProgress.imported}
            {" · "}
            skipped {importProgress.skipped}
            {" · "}
            failed {importProgress.failed}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 30,
    backgroundColor: "#fff",
  },
  section: {
    width: "100%",
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    color: "#999",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  npubRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F0FF",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  npub: {
    flex: 1,
    fontSize: 14,
    color: "#333",
    fontFamily: "monospace",
  },
  copyIcon: {
    fontSize: 18,
    color: "#7B2FF2",
    marginLeft: 10,
  },
  hint: {
    marginTop: 6,
    fontSize: 13,
    color: "#bbb",
  },
  syncHint: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 18,
    color: "#666",
  },
  importButton: {
    alignSelf: "flex-start",
    backgroundColor: "#0A84FF",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    marginTop: 4,
  },
  importButtonDisabled: {
    opacity: 0.7,
  },
  importButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 15,
  },
  spacer: {
    flex: 1,
  },
  clearButton: {
    alignSelf: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#999",
    marginBottom: 16,
  },
  clearText: {
    color: "#999",
    fontWeight: "600",
  },
  logoutButton: {
    alignSelf: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e00",
    marginBottom: 40,
  },
  logoutText: {
    color: "#e00",
    fontWeight: "600",
  },
  button: {
    backgroundColor: "#7B2FF2",
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 10,
    marginTop: 20,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 18,
    color: "#666",
  },
  progressDock: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 24,
    backgroundColor: "#F4F8FF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#D7E6FF",
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0A84FF",
    marginBottom: 10,
  },
  progressTrack: {
    height: 8,
    backgroundColor: "#D7E6FF",
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#0A84FF",
    borderRadius: 999,
  },
  progressMeta: {
    marginTop: 10,
    color: "#4A5C73",
    fontSize: 12,
    lineHeight: 16,
  },
});
