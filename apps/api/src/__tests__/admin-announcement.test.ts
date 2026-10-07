import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, TEST_USER } from "./test-helpers";

const mockGetSession = vi.fn();
const mockFetch = vi.fn();

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("../db/index", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

vi.stubGlobal("fetch", mockFetch);

import { adminRoutes } from "../routes/admin";

const ADMIN_USER = {
  ...TEST_USER,
  username: "adminuser",
  isAnonymous: false,
  guestExpiresAt: null,
};

function createApp() {
  return createTestApp(adminRoutes, "/");
}

describe("POST /api/admin/announcement", () => {
  const app = createApp();

  beforeEach(() => {
    process.env.ADMIN_USERNAME = "adminuser";
    delete process.env.VERCEL_API_TOKEN;
    delete process.env.GLOBAL_CONFIG_ID;
    delete process.env.EDGE_CONFIG_ID;
    mockFetch.mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await app.request("/api/admin/announcement", {
      method: "POST",
      body: JSON.stringify({ message: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockGetSession.mockResolvedValue({
      user: { ...ADMIN_USER, username: "notadmin" },
      session: { id: "session-1" },
    });
    const res = await app.request("/api/admin/announcement", {
      method: "POST",
      body: JSON.stringify({ message: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(403);
  });

  it("returns 503 when env vars are missing", async () => {
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    const res = await app.request("/api/admin/announcement", {
      method: "POST",
      body: JSON.stringify({ message: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(503);
  });

  it("returns 400 when message is not a string", async () => {
    process.env.VERCEL_API_TOKEN = "token";
    process.env.GLOBAL_CONFIG_ID = "gcfg_xxx";
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    const res = await app.request("/api/admin/announcement", {
      method: "POST",
      body: JSON.stringify({ message: 42 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("updates Global Config and returns message", async () => {
    process.env.VERCEL_API_TOKEN = "token";
    process.env.GLOBAL_CONFIG_ID = "gcfg_xxx";
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    mockFetch.mockResolvedValue({ ok: true });
    const res = await app.request("/api/admin/announcement", {
      method: "POST",
      body: JSON.stringify({ message: "障害が発生しています" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "障害が発生しています" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.vercel.com/v1/global-config/gcfg_xxx/items",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("updates Global Config using legacy EDGE_CONFIG_ID when GLOBAL_CONFIG_ID is unset", async () => {
    process.env.VERCEL_API_TOKEN = "token";
    process.env.EDGE_CONFIG_ID = "ecfg_xxx";
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    mockFetch.mockResolvedValue({ ok: true });
    const res = await app.request("/api/admin/announcement", {
      method: "POST",
      body: JSON.stringify({ message: "障害が発生しています" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.vercel.com/v1/global-config/ecfg_xxx/items",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("clears announcement when message is empty string", async () => {
    process.env.VERCEL_API_TOKEN = "token";
    process.env.GLOBAL_CONFIG_ID = "gcfg_xxx";
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    mockFetch.mockResolvedValue({ ok: true });
    const res = await app.request("/api/admin/announcement", {
      method: "POST",
      body: JSON.stringify({ message: "" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: null });
  });

  it("returns 502 when Vercel API fails", async () => {
    process.env.VERCEL_API_TOKEN = "token";
    process.env.GLOBAL_CONFIG_ID = "gcfg_xxx";
    mockGetSession.mockResolvedValue({
      user: ADMIN_USER,
      session: { id: "session-1" },
    });
    mockFetch.mockResolvedValue({ ok: false });
    const res = await app.request("/api/admin/announcement", {
      method: "POST",
      body: JSON.stringify({ message: "test" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(502);
  });
});
