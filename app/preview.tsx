import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useFastRoutes, usePrefetchRoutes } from "../lib/use-fast-routes";
import { useTapGuard } from "../lib/use-tap-guard";

export default function PreviewScreen() {
  const { uri } = useLocalSearchParams<{ uri: string }>();
  const { prefetchRoute, replaceWith } = useFastRoutes();
  const guardTap = useTapGuard(180);

  usePrefetchRoutes(["/camera"]);

  return (
    <View style={styles.container}>
      {uri ? (
        <Image source={{ uri }} style={styles.image} contentFit="contain" />
      ) : (
        <Text style={styles.errorText}>No photo to display.</Text>
      )}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.button}
          onPressIn={() => prefetchRoute("/camera")}
          onPress={() => guardTap(() => replaceWith("/camera"))}
        >
          <Text style={styles.buttonText}>Take Another</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.doneButton]}
          onPressIn={() => prefetchRoute("/camera")}
          onPress={() => guardTap(() => replaceWith("/camera"))}
        >
          <Text style={styles.buttonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  image: {
    flex: 1,
  },
  errorText: {
    color: "#fff",
    fontSize: 18,
    textAlign: "center",
    marginTop: 100,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 20,
    paddingBottom: 40,
    backgroundColor: "#000",
  },
  button: {
    backgroundColor: "#333",
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 10,
  },
  doneButton: {
    backgroundColor: "#7B2FF2",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
