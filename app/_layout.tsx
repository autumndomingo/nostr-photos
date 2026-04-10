import "../lib/fetch-polyfill";
import "../lib/crypto-polyfill";
import "react-native-get-random-values";
import { useEffect } from "react";
import { Alert, AppState, InteractionManager } from "react-native";
import { Stack } from "expo-router";
import {
  loadPrivateKey,
  retryPendingMerkleRootPublish,
} from "../lib/nostr";
import {
  ensureIrisCompatiblePhotoLibrary,
  ensureSequentialPhotoLibrary,
} from "../lib/photo-sync";
import {
  resumePendingPhotoImport,
  subscribeToPhotoImport,
} from "../lib/photo-import-manager";

export default function RootLayout() {
  useEffect(() => {
    let cancelled = false;
    let importCompletionShown = false;

    const initialize = async () => {
      const privateKey = await loadPrivateKey().catch(() => null);

      InteractionManager.runAfterInteractions(() => {
        if (cancelled || !privateKey) {
          return;
        }

        retryPendingMerkleRootPublish(privateKey).catch(() => {});
        ensureSequentialPhotoLibrary(privateKey).catch(() => {});
        ensureIrisCompatiblePhotoLibrary(privateKey).catch(() => {});
      });

      resumePendingPhotoImport().catch(() => {});
    };

    initialize().catch(() => {});

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        resumePendingPhotoImport().catch(() => {});
      }
    });

    const unsubscribeImport = subscribeToPhotoImport((snapshot) => {
      if (snapshot.active) {
        importCompletionShown = false;
      }

      if (
        snapshot.result?.status === "completed" &&
        !snapshot.active &&
        !importCompletionShown
      ) {
        importCompletionShown = true;
        Alert.alert("uplaoding done");
      }
    });

    return () => {
      cancelled = true;
      appStateSubscription.remove();
      unsubscribeImport();
    };
  }, []);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#7B2FF2" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "bold" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Nostr Photos" }} />
      <Stack.Screen name="settings" options={{ title: "Profile" }} />
      <Stack.Screen name="camera" options={{ title: "Camera", headerShown: false }} />
      <Stack.Screen name="preview" options={{ title: "Photo Preview" }} />
      <Stack.Screen name="gallery" options={{ title: "Library", headerShown: false }} />
      <Stack.Screen name="library" options={{ title: "All Photos", headerShown: false }} />
    </Stack>
  );
}
