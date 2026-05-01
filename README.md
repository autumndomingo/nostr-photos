# Nostr Photos

A decentralized photo and video app built on [Nostr](https://nostr.com) and [Blossom](https://github.com/hzrd149/blossom). Your photos, your keys — no central server, no cloud lock-in.

Built with [Expo](https://expo.dev) (React Native) for iOS and Android.

## What it does

- **Take photos and videos** with a full-featured camera (flash, zoom, front/back flip)
- **Browse your library** in a gallery grid
- **Upload to Blossom** — photos are stored on Nostr-native file servers
- **Merkle hash tree** — your library's integrity is anchored on Nostr
- **Import existing photos** from your phone's camera roll
- **Iris-files compatible** — works alongside the Iris Nostr client
- **Bring your own keys** — create a new Nostr account or log in with your existing `nsec`

## Tech stack

- Expo (React Native) + TypeScript
- `expo-router` for navigation
- `expo-camera`, `expo-media-library`, `expo-secure-store`
- `nostr-tools` for keys, signing, and event publishing
- Custom Merkle tree (`lib/hashtree.ts`)
- Blossom HTTP API for file storage

## Running it locally

You'll need [Node.js](https://nodejs.org), [Expo Go](https://expo.dev/go) on your phone, and your phone on the same Wi-Fi as your computer.

```sh
git clone https://github.com/autumndomingo/nostr-photos.git
cd nostr-photos
npm install
npx expo start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS).

### Run directly on a connected iPhone

Use this when Expo Go is not working. This installs and launches a native debug build from the command line; it does not require opening Xcode.

```sh
# Confirm the phone is connected.
xcrun devicectl list devices

# Get the physical device UDID that Expo accepts.
xcrun xctrace list devices

# Build and install the native app on the phone.
npx expo run:ios --device <device-udid>

# If the app opens to "No script URL provided", confirm Metro is running.
curl http://localhost:8081/status

# Relaunch the installed app directly.
xcrun devicectl device process launch \
  --device <device-udid> \
  --terminate-existing \
  com.anonymous.nostr-photos
```

On Justin's iPhone, `devicectl list devices` reported a CoreDevice identifier, but Expo needed the UDID from `xctrace list devices` instead: `00008140-001E54E90E6A801C`.

## Project layout

```
app/             # Screens (Expo Router)
  index.tsx      # Welcome / login
  camera.tsx     # Camera with photo + video
  gallery.tsx    # Photo grid
  library.tsx    # All photos
  preview.tsx    # Single photo view
  settings.tsx   # Profile / keys
lib/             # Core logic
  nostr.ts                  # Keys, signing, events
  hashtree.ts               # Merkle tree
  storage.ts                # Local persistence
  photo-ingest-manager.ts   # Capture → upload pipeline
  photo-remote-sync.ts      # Blossom upload
  photo-import-manager.ts   # Camera roll import
  session-store.ts          # Secure key storage
```

## Status

Phases 1–6 of the build plan are working: identity, camera, upload, hash tree, gallery, and camera-roll import.

Coming next:
- End-to-end encryption (NIP-44)
- Shared albums
- Direct photo sending to other Nostr users

## Branches

- `main` — current development
- `v1-archive` — earlier snapshot of the project

## License

MIT
