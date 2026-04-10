import { memo, useDeferredValue, useEffect, useMemo, useState, startTransition } from "react";
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
} from "../lib/storage";
import {
  getPendingCapturedPhotos,
  subscribeToPendingCapturedPhotos,
  type PendingCapturedPhoto,
} from "../lib/photo-ingest-manager";
import { buildDisplayPhotos } from "../lib/display-photos";
import { usePrefetchRoutes } from "../lib/use-fast-routes";
import { useSmartBack } from "../lib/use-smart-back";
import { useTapGuard } from "../lib/use-tap-guard";

const SCREEN_WIDTH = Dimensions.get("window").width;
const NUM_COLUMNS = 3;
const TILE_GAP = 2;
const TILE_SIZE = (SCREEN_WIDTH - TILE_GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

const LibraryTile = memo(
  function LibraryTile({ uri, pending }: { uri: string; pending: boolean }) {
    return (
      <TouchableOpacity style={styles.tile}>
        <Image source={{ uri }} style={styles.tileImage} />
        {pending ? <View style={styles.pendingBadge} /> : null}
      </TouchableOpacity>
    );
  },
  (previous, next) =>
    previous.uri === next.uri && previous.pending === next.pending
);

export default function LibraryScreen() {
  const smartBack = useSmartBack("/camera");
  const [photos, setPhotos] = useState<PhotoEntry[]>(() => loadPhotoEntries());
  const [pendingPhotos, setPendingPhotos] = useState<PendingCapturedPhoto[]>(() =>
    getPendingCapturedPhotos()
  );
  const displayPhotos = useMemo(
    () => buildDisplayPhotos(photos, pendingPhotos),
    [pendingPhotos, photos]
  );
  const deferredPhotos = useDeferredValue(displayPhotos);
  const guardTap = useTapGuard(180);

  usePrefetchRoutes(["/camera"]);

  useEffect(() => {
    return subscribeToPhotoEntries((entries) => {
      startTransition(() => {
        setPhotos(entries);
      });
    });
  }, []);

  useEffect(() => {
    return subscribeToPendingCapturedPhotos((entries) => {
      startTransition(() => {
        setPendingPhotos(entries);
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
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No photos yet.</Text>
        }
        renderItem={({ item }) => (
          <LibraryTile uri={item.uri} pending={item.pending} />
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
  pendingBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#0A84FF",
  },
  emptyText: {
    color: "#666",
    fontSize: 16,
    textAlign: "center",
    marginTop: 60,
  },
});
