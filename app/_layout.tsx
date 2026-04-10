import "../lib/fetch-polyfill";
import "../lib/crypto-polyfill";
import "react-native-get-random-values";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { retryPendingMerkleRootPublish } from "../lib/nostr";

export default function RootLayout() {
  useEffect(() => {
    retryPendingMerkleRootPublish().catch(() => {});
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
      <Stack.Screen name="gallery" options={{ title: "Library", headerShown: false, presentation: "transparentModal", animation: "fade" }} />
      <Stack.Screen name="library" options={{ title: "All Photos", headerShown: false }} />
    </Stack>
  );
}
