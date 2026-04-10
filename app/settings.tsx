import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { loadPrivateKey, deletePrivateKey, getNpub } from "../lib/nostr";
import { clearAllData } from "../lib/storage";

export default function SettingsScreen() {
  const router = useRouter();
  const [npub, setNpub] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

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
});
