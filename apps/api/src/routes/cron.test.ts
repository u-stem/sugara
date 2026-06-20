import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  WEATHER_REFRESH_BUDGET_MS: 45_000,
}));

// getRedis returns redisState.client; null (the default) exercises the
// unlocked local/dev path. Tests opt into a Redis client to drive the lock.
const { redisSet, redisDel, redisState } = vi.hoisted(() => {
  const set = vi.fn();
  const del = vi.fn();
  return {
    redisSet: set,
    redisDel: del,
    redisState: { client: null as { set: typeof set; del: typeof del } | null },
  };
});
vi.mock("../lib/redis", () => ({
  getRedis: () => redisState.client,
}));

const WEATHER_LOCK_KEY = "cron:refresh-weather:lock";

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

  // Returning 200 even on an unexpected throw is what keeps Vercel Cron from
  // retry-storming a transient outage into overlapping runs.
  it("returns 200 when refresh throws unexpectedly", async () => {
    refreshAllWeather.mockRejectedValue(new Error("db exploded"));
    const res = await getWeather({ authorization: "Bearer test-cron-secret" });
    expect(res.status).toBe(200);
  });

  it("returns an error body when refresh throws unexpectedly", async () => {
    refreshAllWeather.mockRejectedValue(new Error("db exploded"));
    const res = await getWeather({ authorization: "Bearer test-cron-secret" });
    expect(await res.json()).toEqual({ error: "weather refresh failed" });
  });

  describe("with a redis lock", () => {
    beforeEach(() => {
      redisState.client = { set: redisSet, del: redisDel };
      redisSet.mockReset().mockResolvedValue("OK");
      redisDel.mockReset().mockResolvedValue(1);
    });

    afterEach(() => {
      redisState.client = null;
    });

    it("runs the refresh when the lock is acquired", async () => {
      refreshAllWeather.mockResolvedValue({ updated: 58, skipped: 0, total: 58 });
      await getWeather({ authorization: "Bearer test-cron-secret" });
      expect(refreshAllWeather).toHaveBeenCalledOnce();
    });

    it("releases the lock after running", async () => {
      refreshAllWeather.mockResolvedValue({ updated: 58, skipped: 0, total: 58 });
      await getWeather({ authorization: "Bearer test-cron-secret" });
      expect(redisDel).toHaveBeenCalledWith(WEATHER_LOCK_KEY);
    });

    it("skips the refresh when the lock is already held", async () => {
      redisSet.mockResolvedValue(null);
      await getWeather({ authorization: "Bearer test-cron-secret" });
      expect(refreshAllWeather).not.toHaveBeenCalled();
    });

    it("returns 200 with a locked body when the lock is held", async () => {
      redisSet.mockResolvedValue(null);
      const res = await getWeather({ authorization: "Bearer test-cron-secret" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ locked: true });
    });

    it("does not release a lock it never acquired", async () => {
      redisSet.mockResolvedValue(null);
      await getWeather({ authorization: "Bearer test-cron-secret" });
      expect(redisDel).not.toHaveBeenCalled();
    });

    it("proceeds without locking when redis errors on acquire", async () => {
      redisSet.mockRejectedValue(new Error("redis down"));
      refreshAllWeather.mockResolvedValue({ updated: 58, skipped: 0, total: 58 });
      await getWeather({ authorization: "Bearer test-cron-secret" });
      expect(refreshAllWeather).toHaveBeenCalledOnce();
    });
  });
});
