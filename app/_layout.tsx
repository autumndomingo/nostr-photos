import "../lib/fetch-polyfill";
import "../lib/crypto-polyfill";
import "react-native-get-random-values";
import { useEffect, useRef, useState } from "react";
import { Animated, AppState, Platform, Text } from "react-native";
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
import { getToastSnapshot, subscribeToToast, showToast } from "../lib/toast";

export default function RootLayout() {
  const [toast, setToast] = useState(getToastSnapshot());
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const useNativeDriver = Platform.OS !== "web";

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
        showToast("uplaoding done");
      }
    });

    const unsubscribeToast = subscribeToToast((nextToast) => {
      setToast(nextToast);
    });

    return () => {
      cancelled = true;
      appStateSubscription.remove();
      unsubscribeImport();
      unsubscribeToast();
      for (const cancelTask of cancelDeferredTasks) {
        cancelTask();
      }
      cancelDeferredTasks.clear();
    };
  }, []);

  useEffect(() => {
    Animated.timing(toastOpacity, {
      toValue: toast.visible ? 1 : 0,
      duration: toast.visible ? 180 : 220,
      useNativeDriver,
    }).start();
  }, [toast.visible, toastOpacity, useNativeDriver]);

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#7B2FF2" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "bold" },
          freezeOnBlur: true,
        }}
      >
        <Stack.Screen name="index" options={{ title: "Nostr Photos" }} />
        <Stack.Screen name="settings" options={{ title: "Profile", headerShown: false, animation: "none" }} />
        <Stack.Screen name="camera" options={{ title: "Camera", headerShown: false }} />
        <Stack.Screen name="preview" options={{ title: "Photo Preview" }} />
        <Stack.Screen name="gallery" options={{ title: "Library", headerShown: false, animation: "none" }} />
        <Stack.Screen name="library" options={{ title: "All Photos", headerShown: false, animation: "none" }} />
      </Stack>
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 20,
          right: 20,
          bottom: 36,
          opacity: toastOpacity,
          transform: [
            {
              translateY: toastOpacity.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        }}
      >
        <Animated.View
          style={{
            alignSelf: "center",
            backgroundColor: "rgba(17,17,17,0.94)",
            borderRadius: 999,
            paddingVertical: 10,
            paddingHorizontal: 16,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>
            {toast.message}
          </Text>
        </Animated.View>
      </Animated.View>
    </>
  );
}
