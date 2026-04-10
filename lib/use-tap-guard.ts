import { useCallback, useRef } from "react";

export function useTapGuard(delayMs = 250) {
  const nextAllowedTapAtRef = useRef(0);

  return useCallback(
    (action: () => void) => {
      const now = Date.now();
      if (now < nextAllowedTapAtRef.current) {
        return;
      }

      nextAllowedTapAtRef.current = now + Math.max(0, delayMs);
      action();
    },
    [delayMs]
  );
}
