import { useRef, useState, useEffect } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Text,
  ActivityIndicator,
  Alert,
  Linking,
  Animated,
  Pressable,
} from "react-native";
import { Image } from "expo-image";
import { CameraView, useCameraPermissions } from "expo-camera";
import { File, Paths } from "expo-file-system/next";
import * as MediaLibrary from "expo-media-library";
import { useRouter } from "expo-router";
import { addPhotoEntry, loadPhotoEntries, initStorage } from "../lib/storage";
import { loadPrivateKey, publishMerkleRoot } from "../lib/nostr";
import {
  createHashTree,
  addPhotoToTree,
  loadRootCID,
  getRootKeyHex,
} from "../lib/hashtree";
import { log } from "../lib/logger";

type ZoomLevel = 0.5 | 1 | 2 | 3;
type CameraMode = "photo" | "video";

export default function CameraScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] =
    MediaLibrary.usePermissions();
  const [taking, setTaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [flash, setFlash] = useState<"off" | "on">("off");
  const [zoom, setZoom] = useState<ZoomLevel>(1);
  const [lastMediaUri, setLastMediaUri] = useState<string | null>(null);
  const [mode, setMode] = useState<CameraMode>("photo");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const recordPulse = useRef(new Animated.Value(1)).current;
  const lastTap = useRef<number>(0);

  const cameraGranted = cameraPermission?.granted ?? false;
  const mediaGranted = mediaPermission?.granted ?? false;

  useEffect(() => {
    if (cameraGranted && mediaGranted) {
      setReady(true);
      loadLastMedia();
    }
  }, [cameraGranted, mediaGranted]);

  // Pulse animation for recording indicator
  useEffect(() => {
    if (recording) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(recordPulse, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(recordPulse, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      recordPulse.setValue(1);
    }
  }, [recording]);

  function loadLastMedia() {
    try {
      const entries = loadPhotoEntries();
      if (entries.length > 0) {
        const cached = new File(Paths.document, "photos", `${entries[0].cidHash}.jpg`);
        if (cached.exists) {
          setLastMediaUri(cached.uri);
        }
      }
    } catch {}
  }

  // Still loading permission status
  if (!cameraPermission || !mediaPermission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FFD60A" />
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.center}>
        <Text style={styles.permText}>
          We need camera and photo library access to take and save photos.
        </Text>
        <Text style={styles.statusText}>
          Camera: {cameraGranted ? "Granted" : "Not granted"}
          {"\n"}
          Photos: {mediaGranted ? "Granted" : "Not granted"}
        </Text>
        <TouchableOpacity
          style={styles.permButton}
          onPress={async () => {
            try {
              let camResult = cameraPermission;
              if (!camResult.granted) {
                camResult = await requestCameraPermission();
              }
              let mediaResult = mediaPermission;
              if (!mediaResult.granted) {
                mediaResult = await requestMediaPermission();
              }
              if (camResult.granted && mediaResult.granted) {
                setReady(true);
              } else {
                Alert.alert(
                  "Permissions Required",
                  "Please enable Camera and Photos access in your phone's Settings for Expo Go.",
                  [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Open Settings",
                      onPress: () => Linking.openSettings(),
                    },
                  ]
                );
              }
            } catch (e: any) {
              Alert.alert("Error", e.message);
            }
          }}
        >
          <Text style={styles.permButtonText}>Grant Permissions</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const zoomValue =
    zoom === 0.5 ? 0 : zoom === 1 ? 0.02 : zoom === 2 ? 0.04 : 0.06;

  async function takePhoto() {
    if (!cameraRef.current || taking) return;
    setTaking(true);
    setUploadStatus("Saving...");
    log("[PHOTO] Taking photo...");
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo) {
        log("[PHOTO] No photo returned from camera");
        setTaking(false);
        setUploadStatus(null);
        return;
      }
      log("[PHOTO] Photo taken:", photo.uri);

      // Save locally first
      initStorage();
      const fileName = `photo_${Date.now()}.jpg`;
      const source = new File(photo.uri);
      const dest = new File(Paths.document, "photos", fileName);
      source.copy(dest);
      setLastMediaUri(dest.uri);
      // Upload to Blossom via HashTree
      setUploadStatus("Uploading...");
      const privateKey = await loadPrivateKey();
      if (!privateKey) {
        log("[PHOTO] No private key found");
        setUploadStatus("No key found");
        return;
      }

      const photoBytes = await dest.bytes();
      log("[PHOTO] Uploading", photoBytes.length, "bytes to Blossom...");

      const { tree, blossomStore } = createHashTree(privateKey);
      const currentRoot = loadRootCID();
      const { rootCid, fileCid } = await addPhotoToTree(
        tree,
        blossomStore,
        photoBytes,
        fileName,
        currentRoot
      );
      // Save entry to local photo list
      addPhotoEntry(fileName, fileCid, photoBytes.length);

      const { toHex } = require("@hashtree/core");
      const cidHash = toHex(fileCid.hash);
      const cached = new File(Paths.document, "photos", `${cidHash}.jpg`);
      if (!cached.exists) {
        dest.copy(cached);
      }

      setLastMediaUri(cached.uri);
      setUploadStatus("Stored! Publishing...");

      // Publish Merkle root to Nostr
      const rootHex = toHex(rootCid.hash);
      const rootKeyHex = getRootKeyHex(rootCid);
      const entries = loadPhotoEntries();
      try {
        await publishMerkleRoot(privateKey, rootHex, entries.length, rootKeyHex);
        log("[PHOTO] Done! Root:", rootHex.slice(0, 16) + "...", "Photos:", entries.length);
        setUploadStatus("Done! ✓");
      } catch (pubErr: any) {
        log("[PHOTO] Publish failed:", pubErr?.message);
        setUploadStatus("Saved, publish failed");
      }

      setTimeout(() => setUploadStatus(null), 1500);
    } catch (e: any) {
      log("[PHOTO] UPLOAD ERROR:", e?.message);
      log("[PHOTO] Stack:", e?.stack);
      setUploadStatus(e?.message?.slice(0, 40) || "Upload failed");
      setTimeout(() => setUploadStatus(null), 4000);
    } finally {
      setTaking(false);
    }
  }

  async function startRecording() {
    if (!cameraRef.current || recording) return;
    setRecording(true);
    try {
      const video = await cameraRef.current.recordAsync();
      if (!video) {
        setRecording(false);
        return;
      }

      initStorage();
      const fileName = `video_${Date.now()}.mp4`;
      const source = new File(video.uri);
      const dest = new File(Paths.document, "photos", fileName);
      source.copy(dest);
      setLastMediaUri(dest.uri);
    } catch (e: any) {
      console.warn("Failed to record video:", e);
    } finally {
      setRecording(false);
    }
  }

  function stopRecording() {
    if (cameraRef.current && recording) {
      cameraRef.current.stopRecording();
    }
  }

  function flipCamera() {
    setFacing((prev) => (prev === "back" ? "front" : "back"));
  }

  function handleDoubleTap() {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      flipCamera();
    }
    lastTap.current = now;
  }

  function handleShutterPress() {
    if (mode === "photo") {
      takePhoto();
    } else {
      if (recording) {
        stopRecording();
      } else {
        startRecording();
      }
    }
  }

  return (
    <View style={styles.container}>
      {/* Camera viewfinder — double tap anywhere to flip */}
      <Pressable style={StyleSheet.absoluteFill} onPress={handleDoubleTap}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          flash={flash}
          zoom={zoomValue}
          mode={mode === "video" ? "video" : "picture"}
        />
      </Pressable>

      {/* Recording indicator */}
      {recording && (
        <Animated.View style={[styles.recordBadge, { opacity: recordPulse }]}>
          <View style={styles.recordDot} />
          <Text style={styles.recordText}>REC</Text>
        </Animated.View>
      )}

      {/* Upload status */}
      {uploadStatus && !recording && (
        <View style={styles.uploadBadge}>
          <Text style={styles.uploadText}>{uploadStatus}</Text>
        </View>
      )}

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => setFlash(flash === "off" ? "on" : "off")}
        >
          <Text style={styles.topIcon}>⚡</Text>
          <Text
            style={[
              styles.topLabel,
              flash === "on" && { color: "#FFD60A" },
            ]}
          >
            {flash === "off" ? "OFF" : "ON"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/settings")}>
          <Text style={styles.topIcon}>⚙️</Text>
          <Text style={styles.topLabel}>PROFILE</Text>
        </TouchableOpacity>
      </View>

      {/* Zoom controls */}
      <View style={styles.zoomBar}>
        {([0.5, 1, 2, 3] as ZoomLevel[]).map((level) => (
          <TouchableOpacity
            key={level}
            style={[styles.zoomPill, zoom === level && styles.zoomPillActive]}
            onPress={() => setZoom(level)}
          >
            <Text
              style={[
                styles.zoomText,
                zoom === level && styles.zoomTextActive,
              ]}
            >
              {level === 1 ? "1x" : level === 0.5 ? ".5" : `${level}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomArea}>
        {/* Mode selector */}
        <View style={styles.modeRow}>
          <TouchableOpacity onPress={() => { if (!recording) setMode("video"); }}>
            <Text style={[styles.modeText, mode === "video" && styles.modeActive]}>
              VIDEO
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { if (!recording) setMode("photo"); }}>
            <Text style={[styles.modeText, mode === "photo" && styles.modeActive]}>
              PHOTO
            </Text>
          </TouchableOpacity>
        </View>

        {/* Shutter row: flip — shutter — gallery circle */}
        <View style={styles.shutterRow}>
          <TouchableOpacity
            style={styles.flipButton}
            onPress={flipCamera}
          >
            <Text style={styles.flipIcon}>⟳</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.shutter,
              mode === "video" && styles.shutterVideo,
              (taking || (mode === "photo" && taking)) && styles.shutterDisabled,
            ]}
            onPress={handleShutterPress}
            disabled={taking}
          >
            {mode === "photo" ? (
              <View style={styles.shutterInner} />
            ) : recording ? (
              <View style={styles.stopSquare} />
            ) : (
              <View style={styles.recordCircle} />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.galleryCircle}
            onPress={() => { if (!recording) router.push("/gallery"); }}
          >
            {lastMediaUri ? (
              <Image
                source={{ uri: lastMediaUri }}
                style={styles.galleryCircleImage}
              />
            ) : (
              <View style={styles.galleryCirclePlaceholder}>
                <Text style={styles.galleryCircleIcon}>🖼</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
    padding: 30,
  },

  // Upload status
  uploadBadge: {
    position: "absolute",
    top: 100,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
  },
  uploadText: {
    color: "#FFD60A",
    fontSize: 14,
    fontWeight: "600",
  },

  // Recording indicator
  recordBadge: {
    position: "absolute",
    top: 100,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 6,
  },
  recordDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FF3B30",
  },
  recordText: {
    color: "#FF3B30",
    fontSize: 14,
    fontWeight: "bold",
  },

  // Top bar
  topBar: {
    position: "absolute",
    top: 55,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  topIcon: {
    fontSize: 24,
    textAlign: "center",
  },
  topLabel: {
    color: "#fff",
    fontSize: 10,
    textAlign: "center",
    marginTop: 2,
  },

  // Zoom bar
  zoomBar: {
    position: "absolute",
    bottom: 200,
    alignSelf: "center",
    flexDirection: "row",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 20,
    padding: 3,
  },
  zoomPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: "center",
    alignItems: "center",
  },
  zoomPillActive: {
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  zoomText: {
    color: "#999",
    fontSize: 13,
    fontWeight: "600",
  },
  zoomTextActive: {
    color: "#FFD60A",
  },

  // Bottom area
  bottomArea: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    paddingVertical: 12,
  },
  modeText: {
    color: "#999",
    fontSize: 14,
    fontWeight: "600",
  },
  modeActive: {
    color: "#FFD60A",
  },
  shutterRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: 30,
    paddingTop: 8,
    paddingBottom: 10,
  },

  // Gallery circle
  galleryCircle: {
    width: 55,
    height: 55,
    borderRadius: 27.5,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.5)",
  },
  galleryCircleImage: {
    width: "100%",
    height: "100%",
  },
  galleryCirclePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#333",
    justifyContent: "center",
    alignItems: "center",
  },
  galleryCircleIcon: {
    fontSize: 22,
  },

  // Shutter
  shutter: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    borderWidth: 4,
    borderColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  shutterVideo: {
    borderColor: "#FF3B30",
  },
  shutterDisabled: {
    opacity: 0.5,
  },
  shutterInner: {
    width: 63,
    height: 63,
    borderRadius: 31.5,
    backgroundColor: "#fff",
  },
  recordCircle: {
    width: 63,
    height: 63,
    borderRadius: 31.5,
    backgroundColor: "#FF3B30",
  },
  stopSquare: {
    width: 30,
    height: 30,
    borderRadius: 4,
    backgroundColor: "#FF3B30",
  },

  // Flip camera
  flipButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  flipIcon: {
    color: "#fff",
    fontSize: 28,
  },

  // Permission screen
  permText: {
    color: "#fff",
    fontSize: 18,
    textAlign: "center",
    marginBottom: 12,
  },
  statusText: {
    color: "#888",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 20,
  },
  permButton: {
    backgroundColor: "#FFD60A",
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 10,
  },
  permButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "600",
  },
});
