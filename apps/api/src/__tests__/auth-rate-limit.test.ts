import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/redis", () => ({
  getRedis: vi.fn(() => null),
}));

vi.mock("../lib/auth", () => ({
  auth: {
    handler: vi.fn(() => new Response(JSON.stringify({ session: null }), { status: 200 })),
  },
}));

vi.mock("../lib/app-settings", () => ({
  getAppSettings: vi.fn(() => Promise.resolve({ signupEnabled: true })),
}));

const { authRoutes } = await import("../routes/auth");

// The in-memory rate-limit store is keyed by "window:max" and shared across
// tests in this file, so each test uses a distinct IP to stay isolated.
async function request(path: string, ip: string): Promise<Response> {
  return authRoutes.request(path, { headers: { "x-real-ip": ip } });
}

describe("auth route rate limits", () => {
  it("does not block get-session at the broad 30/min ceiling", async () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 31; i++) {
      await request("/api/auth/get-session", ip);
    }
    const res = await request("/api/auth/get-session", ip);

    expect(res.status).toBe(200);
  });

  it("caps get-session at its dedicated 300/min ceiling", async () => {
    const ip = "10.0.0.2";
    // 300 requests fill the bucket exactly (count == max); the 301st exceeds it.
    for (let i = 0; i < 300; i++) {
      await request("/api/auth/get-session", ip);
    }
    const res = await request("/api/auth/get-session", ip);

    expect(res.status).toBe(429);
  });

  it("does not count get-session against the broad auth bucket", async () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < 30; i++) {
      await request("/api/auth/get-session", ip);
    }
    const res = await request("/api/auth/list-sessions", ip);

    expect(res.status).toBe(200);
  });

  it("still applies the broad 30/min ceiling to other auth paths", async () => {
    const ip = "10.0.0.4";
    for (let i = 0; i < 30; i++) {
      await request("/api/auth/list-sessions", ip);
    }
    const res = await request("/api/auth/list-sessions", ip);

    expect(res.status).toBe(429);
  });
});
