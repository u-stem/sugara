/**
 * View mode utility for desktop/SP (smartphone) page switching.
 *
 * Uses a cookie (`x-view-mode`) to persist the user's preference.
 * - `"sp"` — force SP pages
 * - `"desktop"` — force desktop pages
 * - absent — auto-detect via User-Agent (middleware handles this)
 */

export const VIEW_MODE_COOKIE = "x-view-mode";
export type ViewMode = "desktop" | "sp";

/** Authenticated routes that have SP counterparts. */
export const SP_ROUTES = [
  "/home",
  "/bookmarks",
  "/articles",
  "/friends",
  "/trips",
  "/settings",
  "/users",
  "/notifications",
  "/my",
  "/polls",
  "/tools",
] as const;

/** Routes that exist only in SP and have no desktop counterpart. */
export const SP_ONLY_ROUTES = ["/notifications"] as const;

/** Path prefix for all SP pages. */
export const SP_PREFIX = "/sp";

/**
 * Set the view mode cookie and navigate to the appropriate version.
 * Call this from client components (header toggle button, etc.).
 *
 * Uses the Cookie Store API (Baseline 2025) to persist the preference.
 */
export async function switchViewMode(
  mode: ViewMode,
  navigate: (url: string) => void = (url) => {
    window.location.href = url;
  },
): Promise<void> {
  const maxAge = 60 * 60 * 24 * 365;

  await cookieStore.set({
    name: VIEW_MODE_COOKIE,
    value: mode,
    path: "/",
    expires: Date.now() + maxAge * 1000,
    sameSite: "lax",
  });

  const { pathname, search, hash } = window.location;

  if (mode === "sp") {
    // Currently on desktop → navigate to SP (only if the route has an SP counterpart)
    if (!pathname.startsWith(SP_PREFIX)) {
      const hasSpCounterpart = SP_ROUTES.some(
        (route) => pathname === route || pathname.startsWith(`${route}/`),
      );
      const dest = hasSpCounterpart ? `${SP_PREFIX}${pathname}` : `${SP_PREFIX}/home`;
      navigate(`${dest}${search}${hash}`);
    }
  } else {
    // Currently on SP → navigate to desktop
    if (pathname.startsWith(SP_PREFIX)) {
      const stripped = pathname.slice(SP_PREFIX.length) || "/home";
      const isSpOnly = SP_ONLY_ROUTES.some(
        (route) => stripped === route || stripped.startsWith(`${route}/`),
      );
      const desktopPath = isSpOnly ? "/home" : stripped;
      navigate(`${desktopPath}${search}${hash}`);
    }
  }
}

/**
 * Check if the current page is an SP page (client-side).
 */
export function isSpPage(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.startsWith(SP_PREFIX);
}

/**
 * Mobile User-Agent detection regex.
 * Used by middleware for auto-redirect when no cookie preference exists.
 */
export const MOBILE_UA_REGEX = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
