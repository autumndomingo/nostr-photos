import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import {
  createAccount,
  savePrivateKey,
  nsecToPrivateKey,
  loadPrivateKey,
  getNpub,
} from "../lib/nostr";
import { useEffect } from "react";

export default function WelcomeScreen() {
  const router = useRouter();
  const [nsecInput, setNsecInput] = useState("");
  const [loading, setLoading] = useState(true);

  // On mount, check if user already has a key saved
  useEffect(() => {
    loadPrivateKey().then((key) => {
      if (key) {
        // Already logged in — go straight to camera
        router.replace("/camera");
      } else {
        setLoading(false);
      }
    });
  }, []);

  async function handleCreateAccount() {
    try {
      const account = createAccount();
      await savePrivateKey(account.privateKey);
      Alert.alert("Account Created!", `Your public key:\n${account.npub}`);
      router.replace("/camera");
    } catch (e: any) {
      Alert.alert("Error", e.message);
    }
  }

  async function handleLogin() {
    const trimmed = nsecInput.trim();
    if (!trimmed) {
      Alert.alert("Error", "Please paste your nsec private key.");
      return;
    }
    try {
      const privateKey = nsecToPrivateKey(trimmed);
      await savePrivateKey(privateKey);
      const npub = getNpub(privateKey);
      Alert.alert("Logged in!", `Your public key:\n${npub}`);
      router.replace("/camera");
    } catch (e: any) {
      Alert.alert("Invalid Key", "That doesn't look like a valid nsec key.");
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#7B2FF2" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Welcome to Nostr Photos</Text>
        <Text style={styles.subtitle}>
          Your photos, encrypted and decentralized.
        </Text>

        <TouchableOpacity style={styles.button} onPress={handleCreateAccount}>
          <Text style={styles.buttonText}>Create New Account</Text>
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.line} />
          <Text style={styles.orText}>OR</Text>
          <View style={styles.line} />
        </View>

        <Text style={styles.label}>Log in with your nsec key:</Text>
        <TextInput
          style={styles.input}
          placeholder="nsec1..."
          placeholderTextColor="#999"
          value={nsecInput}
          onChangeText={setNsecInput}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={handleLogin}
        >
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>
            Log In
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#7B2FF2",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginBottom: 40,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#7B2FF2",
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#7B2FF2",
  },
  secondaryButtonText: {
    color: "#7B2FF2",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 30,
    width: "100%",
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: "#ddd",
  },
  orText: {
    marginHorizontal: 12,
    color: "#999",
    fontSize: 14,
  },
  label: {
    alignSelf: "flex-start",
    fontSize: 14,
    color: "#333",
    marginBottom: 8,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 14,
    fontSize: 16,
    marginBottom: 16,
    color: "#333",
  },
});
