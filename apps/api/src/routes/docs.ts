import { Scalar } from "@scalar/hono-api-reference";
import type { Context, Next } from "hono";
import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { auth } from "../lib/auth";
import { requireAuth } from "../middleware/auth";
import { requireNonGuest } from "../middleware/require-non-guest";
import type { AppEnv } from "../types";
import { v1App } from "./v1/index";

// Authentication is attached per-route rather than via use("*") to follow the
// same pattern as ogp.ts. This router is mounted under the narrow "/api/_docs"
// prefix, so use("*") would be safe here, but per-route attachment is explicit
// and avoids any future accidental expansion if new public sub-paths are added.

export const docsRoutes = new Hono<AppEnv>();

// `in` narrowing keeps this free of type casts: Better Auth's inferred session
// user type does not surface the isAnonymous additional field directly.
function isGuestUser(user: object): boolean {
  return "isAnonymous" in user && user.isAnonymous === true;
}

// Page-style guard for the Scalar UI. Browsers hitting this URL expect the
// same behavior as the web app's protected pages (proxy.ts): redirect to the
// login page when unauthenticated, instead of an API-style JSON 401. Guests
// are sent to /home, mirroring the settings page which blocks guest access.
// The spec endpoint below keeps JSON errors — it is fetched by the UI, not
// navigated to.
async function requireMemberPage(c: Context<AppEnv>, next: Next) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.redirect("/auth/login");
  if (isGuestUser(session.user)) return c.redirect("/home");
  return next();
}

// Minimal Content-Security-Policy for the Scalar UI page.
//
// Directives and their rationale:
//   script-src 'self' 'unsafe-inline'  — standalone.js from same origin;
//     'unsafe-inline' required for Scalar's inline init script
//     (Scalar.createApiReference('#app', config)).
//   style-src 'self' 'unsafe-inline'   — inline <style> injected by the Hono
//     integration (custom CSS theme variables).
//   img-src 'self' data: blob:         — Scalar UI renders spec-defined image
//     references; blob: covers dynamically generated previews.
//   connect-src 'self'                 — KEY directive: restricts all XHR/fetch
//     to same origin, blocking data exfiltration even if script is compromised.
//   worker-src 'self' blob:            — Web workers spawned by the bundle.
//   font-src 'self' data:              — withDefaultFonts:false disables
//     fonts.scalar.com; data: covers any base64-embedded fonts in the bundle.
//   object-src 'none'                  — no plugins (Flash etc.).
//   base-uri 'self'                    — prevents <base> injection attacks.
//   frame-ancestors 'none'             — no embedding in iframes.
//   default-src 'self'                 — catch-all fallback.
const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Middleware that attaches the CSP header before the Scalar handler runs.
// c.header() registers the value in Hono's context header store, which is
// merged into the Response when c.html() is called by Scalar.
async function addDocsCsp(c: Context<AppEnv>, next: Next): Promise<void> {
  c.header("Content-Security-Policy", DOCS_CSP);
  await next();
}

const SPEC_OPTIONS: Parameters<typeof generateSpecs>[1] = {
  documentation: {
    info: { title: "sugara External API", version: "1.1.0" },
    // servers defines the base URL so that spec paths (/trips, /articles, …)
    // are relative to /api/v1. Scalar's Try-it uses this to build full URLs.
    servers: [{ url: "/api/v1" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          // Bearer scheme — callers pass `Authorization: Bearer <api-key>`
          type: "http",
          scheme: "bearer",
        },
      },
    },
    // Apply bearerAuth globally so every operation inherits it unless overridden.
    security: [{ bearerAuth: [] }],
  },
};

// GET /api/_docs/openapi.json
// Generates and returns the OpenAPI 3.1 spec for v1App. Protected so that the
// spec (which reveals endpoint structure and required scopes) is only visible
// to authenticated, non-guest users — the same audience that can issue API keys.
//
// generateSpecs() reads describeRoute metadata from v1App routes and returns a
// plain spec object. Using it inside a regular AppEnv handler avoids any type
// coercion between V1Env (inferred from v1App) and AppEnv.
docsRoutes.get("/openapi.json", requireAuth, requireNonGuest, async (c) => {
  const spec = await generateSpecs(v1App, SPEC_OPTIONS);
  return c.json(spec);
});

// GET /api/_docs
// Serves the Scalar API reference UI.
//
// The standalone bundle (@scalar/api-reference, version pinned in apps/web
// devDependencies) is self-hosted: apps/web/scripts/copy-scalar-assets.ts
// copies it to public/scalar/standalone.js at dev/build time, and Next.js
// serves it from the same origin as /scalar/standalone.js. Zero third-party
// origin dependencies at runtime.
//
// withDefaultFonts:false suppresses the fonts.scalar.com link element that
// the Scalar integration would otherwise inject, completing the same-origin
// isolation: no external fetches at all once the page is loaded.
//
// addDocsCsp injects a Content-Security-Policy header (see DOCS_CSP above)
// before Scalar writes the HTML response. connect-src 'self' is the critical
// directive — it blocks data exfiltration to external hosts even if an attacker
// somehow injects script into the page.
docsRoutes.get(
  "/",
  requireMemberPage,
  addDocsCsp,
  Scalar({
    url: "/api/_docs/openapi.json",
    // Same-origin self-hosted bundle; no cdn.jsdelivr.net or any other
    // third-party origin required. Version is fixed by the @scalar/api-reference
    // devDependency in apps/web/package.json.
    cdn: "/scalar/standalone.js",
    // Disable fonts.scalar.com link injection to achieve full same-origin isolation.
    withDefaultFonts: false,
  }),
);
