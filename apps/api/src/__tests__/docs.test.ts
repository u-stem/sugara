import { beforeEach, describe, expect, it, vi } from "vitest";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// vi.hoisted so that the mock factory runs before module resolution. Pattern
// mirrors middleware.test.ts — mock lib/auth before importing the composed app.
const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

// Disable rate limiting so v1 routes don't reject requests during spec generation.
vi.mock("../lib/external-api/rate-limit", () => ({
  v1RateLimit: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { app } from "../app";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AUTHED_SESSION = {
  user: {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    isAnonymous: false,
  },
  session: { id: "session-1" },
};

const GUEST_SESSION = {
  user: {
    id: "guest-1",
    name: "Guest",
    email: "guest@example.example",
    isAnonymous: true,
  },
  session: { id: "session-2" },
};

// The 7 v1 endpoint paths that must appear in the generated spec.
// Paths are relative to the v1App mount (server url /api/v1).
// hono-openapi converts Hono's :param notation to OpenAPI {param} notation.
const EXPECTED_PATHS = [
  "/trips",
  "/trips/{id}",
  "/trips/{tripId}/expenses",
  "/bookmark-lists",
  "/bookmark-lists/{listId}/bookmarks",
  "/articles",
  "/articles/{id}",
] as const;

// ---------------------------------------------------------------------------
// GET /api/_docs — Scalar UI
// ---------------------------------------------------------------------------

describe("GET /api/_docs (Scalar UI)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The UI is a browser page: failures redirect like the web app's protected
  // pages (proxy.ts) instead of returning API-style JSON errors.
  it("redirects unauthenticated requests with 302", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.request("/api/_docs");

    expect(res.status).toBe(302);
  });

  it("redirects unauthenticated requests to the login page", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.request("/api/_docs");

    expect(res.headers.get("location")).toBe("/auth/login");
  });

  it("redirects guest users with 302", async () => {
    mockGetSession.mockResolvedValue(GUEST_SESSION);

    const res = await app.request("/api/_docs");

    expect(res.status).toBe(302);
  });

  it("redirects guest users to home", async () => {
    mockGetSession.mockResolvedValue(GUEST_SESSION);

    const res = await app.request("/api/_docs");

    expect(res.headers.get("location")).toBe("/home");
  });

  it("returns 200 for authenticated non-guest users", async () => {
    mockGetSession.mockResolvedValue(AUTHED_SESSION);

    const res = await app.request("/api/_docs");

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/_docs/openapi.json — OpenAPI spec
// ---------------------------------------------------------------------------

describe("GET /api/_docs/openapi.json (OpenAPI spec)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await app.request("/api/_docs/openapi.json");

    expect(res.status).toBe(401);
  });

  it("returns 403 for guest (isAnonymous) users", async () => {
    mockGetSession.mockResolvedValue(GUEST_SESSION);

    const res = await app.request("/api/_docs/openapi.json");

    expect(res.status).toBe(403);
  });

  it("returns 200 for authenticated non-guest users", async () => {
    mockGetSession.mockResolvedValue(AUTHED_SESSION);

    const res = await app.request("/api/_docs/openapi.json");

    expect(res.status).toBe(200);
  });

  it("includes all 7 v1 endpoints in the spec paths", async () => {
    mockGetSession.mockResolvedValue(AUTHED_SESSION);

    const res = await app.request("/api/_docs/openapi.json");
    const body = await res.json();

    const paths = isRecord(body) && isRecord(body.paths) ? body.paths : {};
    expect(Object.keys(paths)).toEqual(expect.arrayContaining([...EXPECTED_PATHS]));
  });

  it("defines bearerAuth in components.securitySchemes", async () => {
    mockGetSession.mockResolvedValue(AUTHED_SESSION);

    const res = await app.request("/api/_docs/openapi.json");
    const body = await res.json();

    expect(body.components?.securitySchemes).toHaveProperty("bearerAuth");
  });
});
