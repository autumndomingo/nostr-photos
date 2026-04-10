import "../lib/fetch-polyfill";
import "../lib/crypto-polyfill";
import "react-native-get-random-values";
import { useEffect } from "react";
import { Alert, AppState } from "react-native";
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
import { resumePendingPhotoRootRemoteSync } from "../lib/photo-remote-sync";
import { scheduleAfterInteractions } from "../lib/cooperative";

export default function RootLayout() {
  useEffect(() => {
    let cancelled = false;
    let importCompletionShown = false;
    const cancelDeferredTasks = new Set<() => void>();

    const deferTask = (delayMs: number, task: () => void) => {
      let cancelTask = () => {};
      cancelTask = scheduleAfterInteractions(() => {
        cancelDeferredTasks.delete(cancelTask);
        if (!cancelled) {
          task();
        }
      }, delayMs);
      cancelDeferredTasks.add(cancelTask);
    };

    const initialize = async () => {
      const privateKey = await loadPrivateKey().catch(() => null);

      deferTask(500, () => {
        resumePendingPhotoRootRemoteSync().catch(() => {});
      });

      deferTask(1500, () => {
        resumePendingPhotoImport().catch(() => {});
      });

      if (!privateKey) {
        return;
      }

      deferTask(2500, () => {
        retryPendingMerkleRootPublish(privateKey).catch(() => {});
      });

      deferTask(4500, () => {
        ensureSequentialPhotoLibrary(privateKey).catch(() => {});
      });

      deferTask(9000, () => {
        ensureIrisCompatiblePhotoLibrary(privateKey).catch(() => {});
      });
    };

    initialize().catch(() => {});

    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        deferTask(300, () => {
          resumePendingPhotoRootRemoteSync().catch(() => {});
        });
        deferTask(1200, () => {
          resumePendingPhotoImport().catch(() => {});
        });
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
      for (const cancelTask of cancelDeferredTasks) {
        cancelTask();
      }
      cancelDeferredTasks.clear();
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
