/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { HandlerDidErrorCallbackParam, PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Resolve the offline fallback URL once at startup so the handlerDidError
// plugin can look it up without depending on Serwist's matchPrecache.
const OFFLINE_URL = "/offline";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    // Placed before defaultCache to override its navigation handler.
    // defaultCache uses NetworkFirst without a timeout, which causes
    // infinite loading when offline. This adds a 3s timeout so that
    // offline navigation falls back to cache instead of hanging.
    {
      matcher: ({ request }: { request: Request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "navigations",
        networkTimeoutSeconds: 3,
        plugins: [
          {
            handlerDidError: async (
              _param: HandlerDidErrorCallbackParam,
            ): Promise<Response | undefined> => {
              // Search all caches for the precached offline page
              for (const name of await caches.keys()) {
                const cache = await caches.open(name);
                const match = await cache.match(OFFLINE_URL);
                if (match) return match;
              }
              // Last resort: inline response so navigation never fails silently
              return new Response(
                "<html><body><h1>Offline</h1><p>Please check your connection.</p></body></html>",
                { headers: { "Content-Type": "text/html" } },
              );
            },
          },
        ],
      }),
    },
    // Placed before defaultCache to override its "apis" NetworkFirst handler.
    // Caching /api/ responses can serve a stale snapshot that clobbers
    // fresher client-side cache updates (#123), and it also persists
    // authenticated personal data in Cache Storage. Offline reads are
    // covered by the IndexedDB-persisted TanStack Query cache instead.
    // networkTimeoutSeconds matches the defaultCache entries this shadows
    // (including /api/auth/*, which would otherwise lose its 10s timeout).
    {
      matcher: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
        sameOrigin && url.pathname.startsWith("/api/"),
      handler: new NetworkOnly({ networkTimeoutSeconds: 10 }),
    },
    ...defaultCache,
  ],
  // additionalPrecacheEntries in next.config.ts precaches /offline with revision "1".
  // The handlerDidError plugin above handles fallback directly, so the
  // Serwist-level fallbacks option is no longer needed.
});

serwist.addEventListeners();

// Purge the legacy "apis" runtime cache left by the previous defaultCache
// handler: it may hold stale authenticated API responses (#123).
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete("apis"));
});

// Push notification handlers (separate from serwist)
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data: unknown;
  try {
    data = event.data.json();
  } catch {
    return;
  }

  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as Record<string, unknown>).title !== "string" ||
    typeof (data as Record<string, unknown>).body !== "string" ||
    typeof (data as Record<string, unknown>).url !== "string"
  ) {
    return;
  }

  const { title, body, url } = data as { title: string; body: string; url: string };

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const path = (event.notification.data as { url: string }).url;
      const existing = clientList.find((c) => new URL(c.url).pathname === path);
      if (existing) return existing.focus();
      return self.clients.openWindow(path);
    }),
  );
});
