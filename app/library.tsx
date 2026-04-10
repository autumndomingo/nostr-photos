import { useState, useCallback } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import {
  getLocalCachePathForEntry,
  loadPhotoEntries,
  PhotoEntry,
} from "../lib/storage";

const SCREEN_WIDTH = Dimensions.get("window").width;
const NUM_COLUMNS = 3;
const TILE_GAP = 2;
const TILE_SIZE = (SCREEN_WIDTH - TILE_GAP * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

export default function LibraryScreen() {
  const router = useRouter();
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      setPhotos(loadPhotoEntries());
    }, [])
  );

  function getPhotoUri(entry: PhotoEntry): string {
    const cached = getLocalCachePathForEntry(entry);
    if (cached.exists) {
      return cached.uri;
    }
    return `https://blossom.primal.net/${entry.cidHash}`;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>All Photos</Text>
        <View style={{ width: 60 }} />
      </View>

      <FlatList
        data={photos}
        numColumns={NUM_COLUMNS}
        keyExtractor={(item) => item.cidHash}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No photos yet.</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.tile}>
            <Image source={{ uri: getPhotoUri(item) }} style={styles.tileImage} />
          </TouchableOpacity>
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
