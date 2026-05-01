import { useEffect, useRef, useState } from "react";
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
import { usePathname, useRouter } from "expo-router";
import {
  createAccount,
  nsecToPrivateKey,
} from "../lib/nostr";
import {
  ensureSessionLoaded,
  getSessionSnapshot,
  saveSessionPrivateKey,
  subscribeToSession,
} from "../lib/session-store";
import { useFastRoutes, usePrefetchRoutes } from "../lib/use-fast-routes";
import { useTapGuard } from "../lib/use-tap-guard";

export default function WelcomeScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const { prefetchRoute } = useFastRoutes();
  const [nsecInput, setNsecInput] = useState("");
  const [session, setSession] = useState(getSessionSnapshot());
  const [authBusy, setAuthBusy] = useState(false);
  const redirectingToCamera = useRef(false);
  const guardTap = useTapGuard();

  usePrefetchRoutes(["/camera"]);

  useEffect(() => {
    ensureSessionLoaded().catch(() => {});
    return subscribeToSession((snapshot) => {
      setSession(snapshot);
    });
  }, []);

  const hasKey = !!session.privateKey;

  useEffect(() => {
    if (pathname !== "/") {
      redirectingToCamera.current = false;
      return;
    }

    if (hasKey && !redirectingToCamera.current) {
      redirectingToCamera.current = true;
      router.replace("/camera");
    }
  }, [hasKey, pathname, router]);

  async function handleCreateAccount() {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      const account = createAccount();
      await saveSessionPrivateKey(account.privateKey);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogin() {
    if (authBusy) return;
    const trimmed = nsecInput.trim();
    if (!trimmed) {
      Alert.alert("Error", "Please paste your nsec private key.");
      return;
    }
    setAuthBusy(true);
    try {
      const privateKey = nsecToPrivateKey(trimmed);
      await saveSessionPrivateKey(privateKey);
    } catch (e: any) {
      Alert.alert("Invalid Key", "That doesn't look like a valid nsec key.");
    } finally {
      setAuthBusy(false);
    }
  }

  if (!session.resolved) {
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

        <TouchableOpacity
          style={[styles.button, authBusy && styles.buttonDisabled]}
          onPressIn={() => prefetchRoute("/camera")}
          onPress={() => guardTap(() => void handleCreateAccount())}
          disabled={authBusy}
        >
          <Text style={styles.buttonText}>
            {authBusy ? "Creating…" : "Create New Account"}
          </Text>
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
          style={[
            styles.button,
            styles.secondaryButton,
            authBusy && styles.secondaryButtonDisabled,
          ]}
          onPressIn={() => prefetchRoute("/camera")}
          onPress={() => guardTap(() => void handleLogin())}
          disabled={authBusy}
        >
          <Text style={[styles.buttonText, styles.secondaryButtonText]}>
            {authBusy ? "Logging In…" : "Log In"}
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
  buttonDisabled: {
    opacity: 0.7,
  },
  secondaryButtonDisabled: {
    opacity: 0.7,
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
