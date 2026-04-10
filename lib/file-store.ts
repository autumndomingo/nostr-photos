/**
 * File-backed content-addressed store for React Native.
 * Each chunk is stored as a file named by its hex hash.
 * Persists between app launches — tree data survives restarts.
 */
import { File, Directory, Paths } from "expo-file-system/next";
import { toHex, type Store, type Hash } from "@hashtree/core";

const STORE_DIR = new Directory(Paths.document, "hashtree-store");

function ensureDir() {
  if (!STORE_DIR.exists) {
    STORE_DIR.create({ intermediates: true });
  }
}

function hashToFile(hash: Hash): File {
  return new File(STORE_DIR, toHex(hash));
}

export class FileStore implements Store {
  constructor() {
    ensureDir();
  }

  async put(hash: Hash, data: Uint8Array): Promise<boolean> {
    try {
      const f = hashToFile(hash);
      f.write(data);
      return true;
    } catch {
      return false;
    }
  }

  async get(hash: Hash): Promise<Uint8Array | null> {
    try {
      const f = hashToFile(hash);
      if (!f.exists) return null;
      return f.bytesSync();
    } catch {
      return null;
    }
  }

  async has(hash: Hash): Promise<boolean> {
    try {
      return hashToFile(hash).exists;
    } catch {
      return false;
    }
  }

  async delete(hash: Hash): Promise<boolean> {
    try {
      const f = hashToFile(hash);
      if (f.exists) f.delete();
      return true;
    } catch {
      return false;
    }
  }
}
