import type { QueryClient } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { createIdbPersister } from "@/lib/idb-persister";
import { reportError } from "@/lib/report-error";

// Cache Storage entries that can hold authenticated page output (HTML / RSC /
// data). Names come from the runtime caching rules in app/sw.ts ("navigations",
// the legacy "apis") and serwist's defaultCache in @serwist/next/worker
// ("pages", "pages-rsc", "pages-rsc-prefetch", "next-data", "others").
// The precache (it backs /offline) and static asset caches hold no user data
// and are intentionally kept so the offline shell keeps working after sign-out.
const AUTH_SCOPED_SW_CACHES = [
  "navigations",
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
  "next-data",
  "others",
  "apis",
];

async function deleteServiceWorkerCaches(): Promise<void> {
  // Cache Storage is unavailable in insecure contexts and some privacy modes
  if (typeof caches === "undefined") return;
  await Promise.allSettled(AUTH_SCOPED_SW_CACHES.map((name) => caches.delete(name)));
}

/**
 * Remove every copy of the signed-in user's data held on this device:
 * the in-memory TanStack Query cache, its IndexedDB persistence (which the
 * unauthenticated /offline page reads directly) and the Service Worker page
 * caches. Each step is isolated so one failure cannot leave the others behind.
 */
export async function clearClientCache(queryClient: QueryClient): Promise<void> {
  // Stop in-flight fetches first so a late response cannot repopulate the cache
  // (and the persister) after the clear.
  await queryClient.cancelQueries();
  queryClient.clear();
  await Promise.allSettled([createIdbPersister().removeClient(), deleteServiceWorkerCaches()]);
}

/**
 * Sign out and wipe local data. Local data is removed even when signOut fails
 * (offline, server error): leaving it behind would expose the previous user's
 * data to the next person using this device. The failure is reported rather
 * than thrown so callers can always continue to navigate away.
 */
export async function signOutAndClearClientCache(queryClient: QueryClient): Promise<void> {
  try {
    const result = await authClient.signOut();
    // 4xx is expected here (e.g. the session is already gone after account
    // deletion), so only server-side failures are worth reporting.
    if (result.error && result.error.status >= 500) {
      reportError(new Error("signOut returned a server error"), { status: result.error.status });
    }
  } catch (err) {
    reportError(err);
  } finally {
    await clearClientCache(queryClient);
  }
}
