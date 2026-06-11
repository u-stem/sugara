import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type V1Env, v1ErrorHandler } from "../lib/external-api/errors";
import { requireApiKey } from "../middleware/require-api-key";

const { mockVerifyApiKey } = vi.hoisted(() => ({
  mockVerifyApiKey: vi.fn(),
}));

// Isolate DB access — verifyApiKey hashes the token and queries apiKeys.
vi.mock("../lib/external-api/api-key", () => ({
  verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
}));

// Minimal v1 app: one protected route + the v1 error handler.
function makeApp() {
  const app = new Hono<V1Env>();
  app.onError(v1ErrorHandler);
  app.get("/trips", requireApiKey("trips:read"), (c) => c.json({ ok: true }));
  app.post("/trips", requireApiKey("trips:write"), (c) => c.json({ ok: true }, 201));
  return app;
}

const VALID_KEY = {
  id: "key-1",
  userId: "user-1",
  scopes: ["trips:read"] as string[],
  expiresAt: new Date(Date.now() + 3_600_000),
};

describe("requireApiKey middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when Authorization header is absent", async () => {
    const res = await makeApp().request("/trips");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("returns 401 when Authorization header is not Bearer format", async () => {
    const res = await makeApp().request("/trips", {
      headers: { Authorization: "Token not-bearer" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("returns 401 when verifyApiKey returns null", async () => {
    mockVerifyApiKey.mockResolvedValue(null);

    const res = await makeApp().request("/trips", {
      headers: { Authorization: "Bearer sk_expired_or_wrong" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("returns 403 when key does not hold the required scope", async () => {
    mockVerifyApiKey.mockResolvedValue({ ...VALID_KEY, scopes: ["expenses:read"] });

    const res = await makeApp().request("/trips", {
      headers: { Authorization: "Bearer sk_wrong_scope" },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "insufficient_scope", message: expect.any(String) } });
  });

  it("calls next and returns 200 when key has the required scope", async () => {
    mockVerifyApiKey.mockResolvedValue(VALID_KEY);

    const res = await makeApp().request("/trips", {
      headers: { Authorization: "Bearer sk_valid" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 403 when a read-only key calls a write route", async () => {
    mockVerifyApiKey.mockResolvedValue(VALID_KEY);

    const res = await makeApp().request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_read_only" },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "insufficient_scope", message: expect.any(String) } });
  });

  it("returns 201 when key holds the write scope for a write route", async () => {
    mockVerifyApiKey.mockResolvedValue({ ...VALID_KEY, scopes: ["trips:write"] });

    const res = await makeApp().request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_write" },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 500 with internal_error when verifyApiKey rejects", async () => {
    mockVerifyApiKey.mockRejectedValue(new Error("DB connection failed"));

    const res = await makeApp().request("/trips", {
      headers: { Authorization: "Bearer sk_any" },
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "internal_error", message: expect.any(String) } });
  });
});
