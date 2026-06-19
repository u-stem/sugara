import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "../__tests__/test-helpers";

vi.mock("../lib/env", () => ({
  env: { CRON_SECRET: "test-cron-secret" },
}));

const deleteExpiredGuests = vi.fn();
vi.mock("../lib/cleanup-guests", () => ({
  deleteExpiredGuests: () => deleteExpiredGuests(),
}));

const refreshAllWeather = vi.fn();
vi.mock("../lib/weather-refresh", () => ({
  refreshAllWeather: (...args: unknown[]) => refreshAllWeather(...args),
}));

import { cronRoutes } from "./cron";

function get(headers: Record<string, string> = {}) {
  const app = createTestApp(cronRoutes, "/api");
  return app.request("/api/cron/cleanup-guests", { headers });
}

function getWeather(headers: Record<string, string> = {}) {
  const app = createTestApp(cronRoutes, "/api");
  return app.request("/api/cron/refresh-weather", { headers });
}

describe("GET /api/cron/cleanup-guests", () => {
  beforeEach(() => {
    deleteExpiredGuests.mockReset();
  });

  it("rejects requests without a bearer token", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    expect(deleteExpiredGuests).not.toHaveBeenCalled();
  });

  it("rejects requests with a wrong secret", async () => {
    const res = await get({ authorization: "Bearer wrong-secret" });
    expect(res.status).toBe(401);
    expect(deleteExpiredGuests).not.toHaveBeenCalled();
  });

  it("deletes expired guests with a valid secret", async () => {
    deleteExpiredGuests.mockResolvedValue(3);
    const res = await get({ authorization: "Bearer test-cron-secret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 3 });
    expect(deleteExpiredGuests).toHaveBeenCalledOnce();
  });
});

describe("GET /api/cron/refresh-weather", () => {
  beforeEach(() => {
    refreshAllWeather.mockReset();
  });

  it("rejects requests without a valid secret", async () => {
    const res = await getWeather({ authorization: "Bearer wrong-secret" });
    expect(res.status).toBe(401);
    expect(refreshAllWeather).not.toHaveBeenCalled();
  });

  it("refreshes weather with a valid secret and returns the result", async () => {
    refreshAllWeather.mockResolvedValue({ updated: 56, skipped: 2, total: 58 });
    const res = await getWeather({ authorization: "Bearer test-cron-secret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 56, skipped: 2, total: 58 });
    expect(refreshAllWeather).toHaveBeenCalledOnce();
  });
});
