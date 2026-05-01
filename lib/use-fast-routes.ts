import { usePathname, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useMemo } from "react";
import { scheduleAfterInteractions } from "./cooperative";

function sameRoute(pathname: string, href: Href): boolean {
  if (typeof href !== "string") {
    return false;
  }

  return href.split("?")[0] === pathname;
}

export function usePrefetchRoutes(routes: readonly Href[], delayMs = 120): void {
  const router = useRouter();
  const pathname = usePathname();
  const routeKey = routes.map((route) => String(route)).join("|");

  useEffect(() => {
    const routesToPrefetch = routeKey
      .split("|")
      .filter(Boolean)
      .filter((route) => !sameRoute(pathname, route as Href)) as Href[];

    if (routesToPrefetch.length === 0) {
      return;
    }

    const cancel = scheduleAfterInteractions(() => {
      for (const route of routesToPrefetch) {
        try {
          router.prefetch(route);
        } catch {}
      }
    }, delayMs);

    return cancel;
  }, [delayMs, pathname, routeKey, router]);
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

  return useMemo(
    () => ({
      navigateTo,
      prefetchRoute,
      replaceWith,
    }),
    [navigateTo, prefetchRoute, replaceWith]
  );
}
