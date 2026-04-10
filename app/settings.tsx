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
  ActionSheetIOS,
} from "react-native";
import { useRouter } from "expo-router";
import { loadPrivateKey, deletePrivateKey, getNpub, getNsec } from "../lib/nostr";
import { clearAllData } from "../lib/storage";
import {
  type ImportLibraryProgress,
  type ImportLibraryResult,
} from "../lib/photo-library-import";
import {
  getPhotoImportSnapshot,
  startAllPhotosImportJob,
  startSelectedPhotosImportJob,
  subscribeToPhotoImport,
} from "../lib/photo-import-manager";

export default function SettingsScreen() {
  const router = useRouter();
  const [npub, setNpub] = useState<string | null>(null);
  const [nsec, setNsec] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [importSnapshot, setImportSnapshot] = useState(getPhotoImportSnapshot());

  useEffect(() => {
    loadPrivateKey().then((key) => {
      if (key) {
        setNpub(getNpub(key));
        setNsec(getNsec(key));
      }
      setLoading(false);
    });

    return subscribeToPhotoImport((snapshot) => {
      setImportSnapshot(snapshot);
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

  async function copyText(value: string) {
    if (Platform.OS === "web") {
      await navigator.clipboard.writeText(value);
      return;
    }

    const Clipboard = await import("expo-clipboard");
    await Clipboard.setStringAsync(value);
  }

  function handleCopyNsec() {
    if (!nsec) return;

    Alert.alert(
      "Copy Private Key",
      "Anyone with this nsec can control your account. Copy it only if you trust where you're pasting it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Copy nsec",
          onPress: async () => {
            try {
              await copyText(nsec);
              setSecretCopied(true);
              setTimeout(() => setSecretCopied(false), 2000);
            } catch {
              Alert.alert("Private Key", nsec);
            }
          },
        },
      ]
    );
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

  function handleImportResult(result: ImportLibraryResult) {
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
    }
  }

  function getProgressPercent(progress: ImportLibraryProgress | null, isImporting: boolean): number {
    if (!progress) return 0;

    switch (progress.phase) {
      case "checking-permissions":
        return 8;
      case "selecting":
        return 14;
      case "loading":
        return 24;
      case "importing": {
        const total = Math.max(progress.total, 1);
        return 24 + (progress.processed / total) * 66;
      }
      case "publishing": {
        if (progress.total <= 0) return 94;
        const total = Math.max(progress.total, 1);
        return 90 + (progress.processed / total) * 8;
      }
      case "complete":
        return 100;
      case "error":
      case "cancelled":
        return progress.total > 0 ? Math.min(99, (progress.processed / progress.total) * 100) : 0;
      default:
        return isImporting ? 8 : 0;
    }
  }

  const importing = importSnapshot.active;
  const importProgress = importSnapshot.progress;

  async function startAllPhotosImport() {
    if (importing) return;

    if (Platform.OS !== "ios") {
      Alert.alert("Unavailable", "Library import is iPhone-only for now.");
      return;
    }

    try {
      const result = await startAllPhotosImportJob();
      if (result) {
        handleImportResult(result);
      }
    } catch (error: any) {
      Alert.alert("Import Failed", error?.message || "Could not import your photo library.");
    }
  }

  async function startSelectedPhotosImport() {
    if (importing) return;

    if (Platform.OS !== "ios") {
      Alert.alert("Unavailable", "Library import is iPhone-only for now.");
      return;
    }

    try {
      const result = await startSelectedPhotosImportJob();
      if (result) {
        handleImportResult(result);
      }
    } catch (error: any) {
      Alert.alert(
        "Import Failed",
        error?.message || "Could not import the selected photos."
      );
    }
  }

  function handleImportLibrary() {
    if (importing) return;

    if (Platform.OS !== "ios") {
      Alert.alert("Unavailable", "Library import is iPhone-only for now.");
      return;
    }

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [
          "Select Photos...",
          "Allow Access to All Photos",
          "Cancel",
        ],
        cancelButtonIndex: 2,
      },
      (buttonIndex) => {
        if (buttonIndex === 0) {
          void startSelectedPhotosImport();
        } else if (buttonIndex === 1) {
          void startAllPhotosImport();
        }
      }
    );
  }

  const totalToProcess = importProgress?.total || 0;
  const progressPercent = getProgressPercent(importProgress, importing);
  const progressPercentText = `${Math.max(0, Math.min(100, Math.round(progressPercent)))}%`;
  const progressWidth = `${progressPercent}%` as const;
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
      <View style={styles.topActions}>
        <TouchableOpacity style={styles.topLogoutButton} onPress={handleLogout}>
          <Text style={styles.topLogoutText}>Log Out</Text>
        </TouchableOpacity>
      </View>

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

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Private Key</Text>
        <TouchableOpacity style={styles.secretButton} onPress={handleCopyNsec}>
          <Text style={styles.secretButtonText}>
            {secretCopied ? "Copied nsec" : "Copy nsec for Iris"}
          </Text>
        </TouchableOpacity>
        <Text style={styles.secretHint}>
          This copies your private key to the clipboard so you can log in elsewhere.
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

      {importProgress ? (
        <View style={styles.progressDock}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>{progressLabel}</Text>
            <Text style={styles.progressPercent}>{progressPercentText}</Text>
          </View>
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
  topActions: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
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
  secretButton: {
    alignSelf: "flex-start",
    backgroundColor: "#111",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 4,
  },
  secretButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  secretHint: {
    marginTop: 8,
    fontSize: 13,
    color: "#666",
    lineHeight: 18,
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
  topLogoutButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e00",
  },
  topLogoutText: {
    color: "#e00",
    fontWeight: "600",
    fontSize: 12,
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
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  progressPercent: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0A84FF",
    minWidth: 44,
    textAlign: "right",
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
