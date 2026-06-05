import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAppSettings = vi.fn();

vi.mock("../lib/app-settings", () => ({
  getAppSettings: (...args: unknown[]) => mockGetAppSettings(...args),
}));

// Mock Better Auth handler to avoid real auth processing
vi.mock("../lib/auth", () => ({
  auth: {
    handler: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  },
}));

import { authRoutes } from "../routes/auth";

function createApp() {
  const app = new Hono();
  app.route("/", authRoutes);
  return app;
}

describe("POST /api/auth/sign-up/* (signup interceptor)", () => {
  const app = createApp();

  beforeEach(() => {
    mockGetAppSettings.mockResolvedValue({ signupEnabled: true });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // Each test uses a unique IP so the per-IP rate limit middleware (mounted in
  // routes/auth.ts) does not bleed counts across cases.
  it("passes through when signup is enabled", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.1" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 when signup is disabled", async () => {
    mockGetAppSettings.mockResolvedValue({ signupEnabled: false });
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.2" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("新規利用の受付を停止しています");
  });

  it("does not block sign-in routes when signup is disabled", async () => {
    mockGetAppSettings.mockResolvedValue({ signupEnabled: false });
    const res = await app.request("/api/auth/sign-in/anonymous", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.3" },
    });
    // Not intercepted, reaches Better Auth mock
    expect(res.status).toBe(200);
  });

  it("returns 403 when DB error occurs (fail-closed)", async () => {
    mockGetAppSettings.mockRejectedValue(new Error("DB connection failed"));
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "x-forwarded-for": "10.0.0.4" },
    });
    expect(res.status).toBe(403);
  });
});
