import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { MOBILE_UA_REGEX, SP_ONLY_ROUTES, SP_PREFIX, SP_ROUTES, VIEW_MODE_COOKIE } from "@/lib/view-mode";

const protectedPaths = ["/home", "/trips", "/bookmarks", "/articles", "/friends", "/settings", "/my", "/tools", "/sp", "/admin"];
const guestOnlyPaths = ["/", "/auth/login", "/auth/signup"];

const isDev = process.env.NODE_ENV === "development";

function buildCspHeader(nonce: string): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} https://maps.googleapis.com`,
    `style-src 'self' 'unsafe-inline'`,
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' blob: data: https://api.dicebear.com https://*.supabase.co https://maps.gstatic.com https://maps.googleapis.com https://*.ggpht.com",
    // https://*.sentry.io allows the Sentry browser SDK to send events (ingest
    // host is o<org>.ingest.<region>.sentry.io). For an EU project this also
    // needs to match; *.sentry.io covers the region subdomains.
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.dicebear.com https://maps.googleapis.com https://routes.googleapis.com https://*.sentry.io${isDev ? " ws://127.0.0.1:* http://127.0.0.1:*" : ""}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "worker-src 'self' blob:",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ];
  return directives.join("; ");
}

function applyCspHeaders(response: NextResponse, nonce: string): NextResponse {
  const csp = buildCspHeader(nonce);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-nonce", nonce);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // ── SP ↔ Desktop redirect ──────────────────────────────
  const viewMode = request.cookies.get(VIEW_MODE_COOKIE)?.value;
  const ua = request.headers.get("user-agent") ?? "";
  const isMobileUA = MOBILE_UA_REGEX.test(ua);
  const isOnSp = pathname.startsWith(SP_PREFIX);
  // /print and /export have no SP counterparts; skip SP redirect for these sub-paths
  const isSpExcludedSubpath = /\/(print|export)(\/|$)/.test(pathname);
  const isOnAuthenticatedRoute =
    !isSpExcludedSubpath &&
    SP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  let desiredMode: "desktop" | "sp";
  if (viewMode === "desktop" || viewMode === "sp") {
    desiredMode = viewMode;
  } else {
    desiredMode = isMobileUA ? "sp" : "desktop";
  }

  if (desiredMode === "sp" && !isOnSp && isOnAuthenticatedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = `${SP_PREFIX}${pathname}`;
    return NextResponse.redirect(url);
  }

  if (desiredMode === "desktop" && isOnSp) {
    const stripped = pathname.slice(SP_PREFIX.length) || "/home";
    const isSpOnly = SP_ONLY_ROUTES.some(
      (route) => stripped === route || stripped.startsWith(`${route}/`),
    );
    const url = request.nextUrl.clone();
    url.pathname = isSpOnly ? "/home" : stripped;
    return NextResponse.redirect(url);
  }

  // Redirect /sp/[path] to /[path] when the path has no SP counterpart (e.g. /sp/admin → /admin).
  // SP_ROUTES lists the only routes that have dedicated SP pages.
  if (isOnSp) {
    const desktopPathname = pathname.slice(SP_PREFIX.length) || "/home";
    const hasSpCounterpart = SP_ROUTES.some(
      (route) => desktopPathname === route || desktopPathname.startsWith(`${route}/`),
    );
    if (!hasSpCounterpart) {
      const url = request.nextUrl.clone();
      url.pathname = desktopPathname;
      return NextResponse.redirect(url);
    }
  }

  // ── Auth guard ─────────────────────────────────────────
  const isProtected = protectedPaths.some((path) => pathname.startsWith(path));
  const isGuestOnly = guestOnlyPaths.includes(pathname);

  if (!isProtected && !isGuestOnly) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    return applyCspHeaders(response, nonce);
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const apiUrl = request.nextUrl.origin;

  try {
    const res = await fetch(`${apiUrl}/api/auth/get-session`, {
      headers: { cookie: cookieHeader },
    });

    const body = res.ok ? await res.json() : null;
    const isAuthenticated = !!body?.session;

    if (isProtected && !isAuthenticated) {
      return NextResponse.redirect(new URL("/auth/login", request.url));
    }

    if (isGuestOnly && isAuthenticated) {
      return NextResponse.redirect(new URL("/home", request.url));
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    return applyCspHeaders(response, nonce);
  } catch (err) {
    console.error("[Proxy] Session check failed:", err);
    // Treat session check failure as unauthenticated for all routes that require auth.
    // This includes both explicitly protected paths and any other path in the matcher.
    if (isGuestOnly) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-nonce", nonce);
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      return applyCspHeaders(response, nonce);
    }
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
}

export const config = {
  matcher: [
    // Match all pages except static files, images, and API routes
    "/((?!api|_next/static|_next/image|sw\\.js|swe-worker|icons|manifest|favicon).*)",
  ],
};
