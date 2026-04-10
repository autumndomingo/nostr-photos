import { InteractionManager } from "react-native";

export async function yieldToUI(frames = 1): Promise<void> {
  const count = Math.max(1, Math.floor(frames));
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

export function scheduleAfterInteractions(
  task: () => void,
  delayMs = 0
): () => void {
  let cancelled = false;
  let interactionHandle: { cancel?: () => void } | null = null;

  const timeoutId = setTimeout(() => {
    if (cancelled) {
      return;
    }

    interactionHandle = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) {
        task();
      }
    });
  }, Math.max(0, delayMs));

  return () => {
    cancelled = true;
    clearTimeout(timeoutId);
    interactionHandle?.cancel?.();
  };
}
