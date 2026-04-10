import { memo, useDeferredValue, useEffect, useState, startTransition } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import {
  loadPhotoEntries,
  PhotoEntry,
  subscribeToPhotoEntries,
  getPhotoDisplayUri,
} from "../lib/storage";
import { usePrefetchRoutes } from "../lib/use-fast-routes";
import { useSmartBack } from "../lib/use-smart-back";
import { useTapGuard } from "../lib/use-tap-guard";

const SCREEN_WIDTH = Dimensions.get("window").width;
const NUM_COLUMNS = 3;
const TILE_GAP = 2;
const TILE_SIZE = (SCREEN_WIDTH - TILE_GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

const LibraryTile = memo(
  function LibraryTile({ uri }: { uri: string }) {
    return (
      <TouchableOpacity style={styles.tile}>
        <Image source={{ uri }} style={styles.tileImage} />
      </TouchableOpacity>
    );
  },
  (previous, next) => previous.uri === next.uri
);

export default function LibraryScreen() {
  const smartBack = useSmartBack("/camera");
  const [photos, setPhotos] = useState<PhotoEntry[]>(() => loadPhotoEntries());
  const deferredPhotos = useDeferredValue(photos);
  const guardTap = useTapGuard(180);

  usePrefetchRoutes(["/camera"]);

  useEffect(() => {
    return subscribeToPhotoEntries((entries) => {
      startTransition(() => {
        setPhotos(entries);
      });
    });
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity hitSlop={10} onPress={() => guardTap(smartBack)}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>All Photos</Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={deferredPhotos}
        numColumns={NUM_COLUMNS}
        initialNumToRender={24}
        maxToRenderPerBatch={24}
        windowSize={5}
        removeClippedSubviews
        keyExtractor={(item) => item.cidHash}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No photos yet.</Text>
        }
        renderItem={({ item }) => (
          <LibraryTile uri={getPhotoDisplayUri(item)} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 55,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    width: 60,
  },
  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  grid: {
    paddingHorizontal: TILE_GAP / 2,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    margin: TILE_GAP / 2,
  },
  tileImage: {
    width: "100%",
    height: "100%",
  },
  emptyText: {
    color: "#666",
    fontSize: 16,
    textAlign: "center",
    marginTop: 60,
  },
});
