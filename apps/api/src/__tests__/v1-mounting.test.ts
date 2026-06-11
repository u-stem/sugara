import { describe, expect, it } from "vitest";
import { app } from "../app";

// Regression tests for v1 mounting on the composed app. The v1 router is
// mounted alongside internal routers; a sibling router's wildcard middleware
// (e.g. a `use("*", requireAuth)` mounted under the broad "/api" prefix) can
// intercept /api/v1 requests before they reach v1, replacing the Bearer auth
// flow and the v1 error shape with the internal cookie-auth response. These
// tests go through `app` (not v1App directly) so that interception is caught.
describe("v1 mounting on the composed app", () => {
  it("returns the v1 error shape for unauthenticated /api/v1 requests", async () => {
    const res = await app.request("/api/v1/trips");
    const body = await res.json();

    expect(body).toMatchObject({ error: { code: "unauthorized" } });
  });

  it("returns 401 for unauthenticated /api/v1 requests", async () => {
    const res = await app.request("/api/v1/trips");

    expect(res.status).toBe(401);
  });

  it("returns the v1 not_found shape for unknown /api/v1 paths", async () => {
    const res = await app.request("/api/v1/does-not-exist");
    const body = await res.json();

    expect(body).toMatchObject({ error: { code: "not_found" } });
  });

  it("returns 404 for unknown /api/v1 paths", async () => {
    const res = await app.request("/api/v1/does-not-exist");

    expect(res.status).toBe(404);
  });
});
