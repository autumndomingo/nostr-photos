import { useState, useCallback, useRef } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  FlatList,
  PanResponder,
  Pressable,
  Animated,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import { loadPhotoEntries, PhotoEntry, getLocalCachePath } from "../lib/storage";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const THUMB_HEIGHT = 40;
const THUMB_WIDTH = 30;
const THUMB_GAP = 2;
const THUMB_TOTAL = THUMB_WIDTH + THUMB_GAP;

export default function GalleryScreen() {
  const router = useRouter();
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showUI, setShowUI] = useState(true);
  const mainListRef = useRef<FlatList>(null);
  const thumbListRef = useRef<FlatList>(null);
  const currentIndexRef = useRef(0);
  const photosRef = useRef<PhotoEntry[]>([]);
  const uiOpacity = useRef(new Animated.Value(1)).current;

  photosRef.current = photos;
  currentIndexRef.current = currentIndex;

  useFocusEffect(
    useCallback(() => {
      const entries = loadPhotoEntries();
      setPhotos(entries);
      setCurrentIndex(0);
      setLoading(false);
    }, [])
  );

  function getPhotoUri(entry: PhotoEntry): string {
    const cached = getLocalCachePath(entry.cidHash);
    if (cached.exists) {
      return cached.uri;
    }
    // Fall back to Blossom URL by hash
    return `https://blossom.primal.net/${entry.cidHash}`;
  }

  function jumpToPhoto(index: number) {
    const total = photosRef.current.length;
    if (index < 0 || index >= total) return;
    setCurrentIndex(index);
    mainListRef.current?.scrollToIndex({ index, animated: false });
  }

  function syncThumbScroll(index: number) {
    thumbListRef.current?.scrollToOffset({
      offset: Math.max(
        0,
        index * THUMB_TOTAL - SCREEN_WIDTH / 2 + THUMB_WIDTH / 2
      ),
      animated: true,
    });
  }

  function onMainScrollEnd(e: any) {
    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrentIndex(index);
    syncThumbScroll(index);
  }

  function toggleUI() {
    const next = !showUI;
    setShowUI(next);
    Animated.timing(uiOpacity, {
      toValue: next ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }

  const dragY = useRef(new Animated.Value(0)).current;
  const dragOpacity = dragY.interpolate({
    inputRange: [0, 200],
    outputRange: [1, 0.3],
    extrapolate: "clamp",
  });

  // Swipe down to dismiss — photo follows your finger
  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => {
        return gesture.dy > 15 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5;
      },
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          dragY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 100) {
          // Animate off screen then navigate
          Animated.timing(dragY, {
            toValue: SCREEN_HEIGHT,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            router.push("/camera");
          });
        } else {
          // Snap back
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 80,
            friction: 10,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#FFD60A" />
        </View>
      ) : photos.length > 0 ? (
        <Animated.View
          style={[
            styles.content,
            {
              transform: [{ translateY: dragY }],
              opacity: dragOpacity,
            },
          ]}
          {...swipeResponder.panHandlers}
        >
          {/* Full screen photo viewer */}
          <FlatList
            ref={mainListRef}
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.cidHash}
            style={styles.mainList}
            onMomentumScrollEnd={onMainScrollEnd}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            renderItem={({ item }) => (
              <Pressable style={styles.slide} onPress={toggleUI}>
                <Image
                  source={{ uri: getPhotoUri(item) }}
                  style={styles.image}
                  contentFit="contain"
                />
              </Pressable>
            )}
          />

          {/* Top bar */}
          <Animated.View
            style={[styles.topBar, { opacity: uiOpacity }]}
            pointerEvents={showUI ? "auto" : "none"}
          >
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.backText}>‹</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push("/library")}>
              <Text style={styles.libraryText}>All Photos</Text>
            </TouchableOpacity>
          </Animated.View>

          {/* Bottom filmstrip */}
          <Animated.View
            style={[styles.bottomBar, { opacity: uiOpacity }]}
            pointerEvents={showUI ? "auto" : "none"}
          >
            <FlatList
              ref={thumbListRef}
              data={photos}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => "thumb_" + item.cidHash}
              contentContainerStyle={styles.thumbContent}
              onScrollEndDrag={(e) => {
                const offset = e.nativeEvent.contentOffset.x;
                const centerIndex = Math.round(
                  (offset + SCREEN_WIDTH / 2) / THUMB_TOTAL
                );
                const clamped = Math.max(0, Math.min(centerIndex, photos.length - 1));
                jumpToPhoto(clamped);
              }}
              onMomentumScrollEnd={(e) => {
                const offset = e.nativeEvent.contentOffset.x;
                const centerIndex = Math.round(
                  (offset + SCREEN_WIDTH / 2) / THUMB_TOTAL
                );
                const clamped = Math.max(0, Math.min(centerIndex, photos.length - 1));
                jumpToPhoto(clamped);
              }}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  onPress={() => {
                    jumpToPhoto(index);
                    syncThumbScroll(index);
                  }}
                  style={[
                    styles.thumb,
                    currentIndex === index && styles.thumbActive,
                  ]}
                >
                  <Image
                    source={{ uri: getPhotoUri(item) }}
                    style={styles.thumbImage}
                  />
                </TouchableOpacity>
              )}
            />
          </Animated.View>
        </Animated.View>
      ) : (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No photos yet. Go take some!</Text>
          <TouchableOpacity
            style={styles.goBackButton}
            onPress={() => router.push("/camera")}
          >
            <Text style={styles.goBackText}>Open Camera</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  content: {
    flex: 1,
    backgroundColor: "#000",
    borderRadius: 10,
    overflow: "hidden",
  },
  mainList: {
    flex: 1,
  },
  slide: {
    width: SCREEN_WIDTH,
    height: "100%",
  },
  image: {
    flex: 1,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 55,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  backText: {
    color: "#fff",
    fontSize: 32,
    fontWeight: "300",
  },
  libraryText: {
    color: "#FFD60A",
    fontSize: 17,
    fontWeight: "600",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 6,
    paddingBottom: 30,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  thumbContent: {
    paddingHorizontal: 4,
  },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    marginHorizontal: THUMB_GAP / 2,
    overflow: "hidden",
    opacity: 0.4,
  },
  thumbActive: {
    opacity: 1,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  thumbImage: {
    width: "100%",
    height: "100%",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    color: "#666",
    fontSize: 16,
    textAlign: "center",
  },
  goBackButton: {
    marginTop: 20,
    backgroundColor: "#FFD60A",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  goBackText: {
    color: "#000",
    fontWeight: "600",
    fontSize: 16,
  },
});
