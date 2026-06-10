import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { requireAuth } from "../middleware/auth";
import { requireNonGuest } from "../middleware/require-non-guest";
import type { AppEnv } from "../types";
import { v1App } from "./v1/index";

// Authentication is attached per-route rather than via use("*") to follow the
// same pattern as ogp.ts. This router is mounted under the narrow "/api/_docs"
// prefix, so use("*") would be safe here, but per-route attachment is explicit
// and avoids any future accidental expansion if new public sub-paths are added.

export const docsRoutes = new Hono<AppEnv>();

const SPEC_OPTIONS: Parameters<typeof generateSpecs>[1] = {
  documentation: {
    info: { title: "sugara External API", version: "1.0.0" },
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
// Serves the Scalar API reference UI. The UI loads its JS/CSS from
// cdn.jsdelivr.net (Scalar's CDN). This is an authenticated internal page,
// not a public endpoint, so loading third-party assets from CDN is acceptable;
// the CDN URL is not subject to the same CSP policy applied to the public web app.
docsRoutes.get("/", requireAuth, requireNonGuest, Scalar({ url: "/api/_docs/openapi.json" }));
