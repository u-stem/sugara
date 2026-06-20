import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, TEST_USER } from "./test-helpers";

const mockGetSession = vi.fn();
const mockRefreshAllWeather = vi.fn();

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("../lib/weather-refresh", () => ({
  refreshAllWeather: (...args: unknown[]) => mockRefreshAllWeather(...args),
  WEATHER_REFRESH_BUDGET_MS: 45_000,
}));

import { adminRoutes } from "../routes/admin";

const ADMIN_USER = {
  ...TEST_USER,
  username: "adminuser",
  isAnonymous: false,
  guestExpiresAt: null,
};

const app = createTestApp(adminRoutes, "/");

function post(body?: unknown) {
  return app.request("/api/admin/weather/refresh", {
    method: "POST",
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  });
}

describe("POST /api/admin/weather/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_USERNAME = "adminuser";
    mockRefreshAllWeather.mockResolvedValue({ updated: 58, skipped: 0, remaining: 0, total: 58 });
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(401);
  });

  it("returns 403 when not admin", async () => {
    mockGetSession.mockResolvedValue({
      user: { ...ADMIN_USER, username: "notadmin" },
      session: { id: "session-1" },
    });
    const res = await post();
    expect(res.status).toBe(403);
  });

  it("does not run the refresh for a non-admin", async () => {
    mockGetSession.mockResolvedValue({
      user: { ...ADMIN_USER, username: "notadmin" },
      session: { id: "session-1" },
    });
    await post();
    expect(mockRefreshAllWeather).not.toHaveBeenCalled();
  });

  it("returns the refresh result for an admin", async () => {
    mockGetSession.mockResolvedValue({ user: ADMIN_USER, session: { id: "session-1" } });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 58, skipped: 0, remaining: 0, total: 58 });
  });

  it("refreshes only stale offices by default", async () => {
    mockGetSession.mockResolvedValue({ user: ADMIN_USER, session: { id: "session-1" } });
    await post();
    expect(mockRefreshAllWeather).toHaveBeenCalledWith(
      expect.objectContaining({ onlyStale: true }),
    );
  });

  it("re-pulls every office when force is true", async () => {
    mockGetSession.mockResolvedValue({ user: ADMIN_USER, session: { id: "session-1" } });
    await post({ force: true });
    expect(mockRefreshAllWeather).toHaveBeenCalledWith(
      expect.objectContaining({ onlyStale: false }),
    );
  });

  it("treats a missing body as a stale-only refresh", async () => {
    mockGetSession.mockResolvedValue({ user: ADMIN_USER, session: { id: "session-1" } });
    await post(); // no JSON body -> parse fallback to {}
    expect(mockRefreshAllWeather).toHaveBeenCalledWith(
      expect.objectContaining({ onlyStale: true }),
    );
  });
});
