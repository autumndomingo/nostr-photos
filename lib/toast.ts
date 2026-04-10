export type ToastSnapshot = {
  visible: boolean;
  message: string;
  id: number;
};

let currentToast: ToastSnapshot = {
  visible: false,
  message: "",
  id: 0,
};

let clearTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(snapshot: ToastSnapshot) => void>();

function emitToast(snapshot: ToastSnapshot) {
  currentToast = snapshot;
  for (const listener of listeners) {
    listener(currentToast);
  }
}

export function showToast(message: string, durationMs = 2200): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
  }

  const nextToast: ToastSnapshot = {
    visible: true,
    message,
    id: currentToast.id + 1,
  };
  emitToast(nextToast);

  clearTimer = setTimeout(() => {
    clearTimer = null;
    emitToast({
      visible: false,
      message: "",
      id: nextToast.id,
    });
  }, Math.max(400, durationMs));
}

export function getToastSnapshot(): ToastSnapshot {
  return currentToast;
}

export function subscribeToToast(
  listener: (snapshot: ToastSnapshot) => void
): () => void {
  listeners.add(listener);
  listener(currentToast);
  return () => {
    listeners.delete(listener);
  };
}
