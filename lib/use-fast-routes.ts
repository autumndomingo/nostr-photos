import { usePathname, useRouter, type Href } from "expo-router";
import { useCallback, useEffect } from "react";
import { scheduleAfterInteractions } from "./cooperative";

function sameRoute(pathname: string, href: Href): boolean {
  if (typeof href !== "string") {
    return false;
  }

  return href.split("?")[0] === pathname;
}

export function usePrefetchRoutes(routes: readonly Href[], delayMs = 120): void {
  const router = useRouter();
  const routeKey = routes.map((route) => String(route)).join("|");

  useEffect(() => {
    const cancel = scheduleAfterInteractions(() => {
      for (const route of routes) {
        try {
          router.prefetch(route);
        } catch {}
      }
    }, delayMs);

    return cancel;
  }, [delayMs, routeKey, router, routes]);
}

export function useFastRoutes() {
  const router = useRouter();
  const pathname = usePathname();

  const prefetchRoute = useCallback(
    (href: Href) => {
      try {
        router.prefetch(href);
      } catch {}
    },
    [router]
  );

  const navigateTo = useCallback(
    (href: Href) => {
      if (sameRoute(pathname, href)) {
        return;
      }

      router.navigate(href);
    },
    [pathname, router]
  );

  const replaceWith = useCallback(
    (href: Href) => {
      if (sameRoute(pathname, href)) {
        return;
      }

      router.replace(href);
    },
    [pathname, router]
  );

  return {
    navigateTo,
    prefetchRoute,
    replaceWith,
  };
}
