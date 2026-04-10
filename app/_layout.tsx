import "../lib/fetch-polyfill";
import "../lib/crypto-polyfill";
import "react-native-get-random-values";
import { useEffect } from "react";
import { Alert, AppState } from "react-native";
import { Stack } from "expo-router";
import {
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
import { resumePendingPhotoIngest } from "../lib/photo-ingest-manager";
import { scheduleAfterInteractions } from "../lib/cooperative";
import { ensureSessionLoaded } from "../lib/session-store";

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
      const session = await ensureSessionLoaded().catch(() => null);
      const privateKey = session?.privateKey ?? null;

      deferTask(500, () => {
        resumePendingPhotoIngest().catch(() => {});
      });

      deferTask(1100, () => {
        resumePendingPhotoRootRemoteSync().catch(() => {});
      });

      deferTask(1900, () => {
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
          resumePendingPhotoIngest().catch(() => {});
        });
        deferTask(900, () => {
          resumePendingPhotoRootRemoteSync().catch(() => {});
        });
        deferTask(1600, () => {
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
        freezeOnBlur: true,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Nostr Photos" }} />
      <Stack.Screen name="settings" options={{ title: "Profile", animation: "none" }} />
      <Stack.Screen name="camera" options={{ title: "Camera", headerShown: false }} />
      <Stack.Screen name="preview" options={{ title: "Photo Preview" }} />
      <Stack.Screen name="gallery" options={{ title: "Library", headerShown: false, animation: "none" }} />
      <Stack.Screen name="library" options={{ title: "All Photos", headerShown: false, animation: "none" }} />
    </Stack>
  );
}
