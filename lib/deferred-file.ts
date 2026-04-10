import { File } from "expo-file-system/next";
import { scheduleAfterInteractions } from "./cooperative";

type DeferredTextWrite = {
  pendingText: string;
  cancel: (() => void) | null;
};

const pendingWrites = new Map<string, DeferredTextWrite>();

export function readDeferredText(file: File): string | null {
  const pending = pendingWrites.get(file.uri);
  if (pending) {
    return pending.pendingText;
  }

  if (!file.exists) {
    return null;
  }

  return file.textSync();
}

export function writeDeferredText(
  file: File,
  text: string,
  delayMs = 60
): void {
  const existing = pendingWrites.get(file.uri);
  existing?.cancel?.();

  const record: DeferredTextWrite = {
    pendingText: text,
    cancel: null,
  };

  record.cancel = scheduleAfterInteractions(() => {
    const latest = pendingWrites.get(file.uri);
    if (!latest) {
      return;
    }
    file.write(latest.pendingText);
    pendingWrites.delete(file.uri);
  }, delayMs);

  pendingWrites.set(file.uri, record);
}

export function clearDeferredText(file: File): void {
  const pending = pendingWrites.get(file.uri);
  pending?.cancel?.();
  pendingWrites.delete(file.uri);
}
