import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, resultQueue } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  resultQueue: [] as unknown[][],
}));

vi.mock("../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

// Each db.select() call resolves to the next queued result, so a test can line
// up the rows for the area query and the forecast query in call order. The
// chain methods (.from/.where/.orderBy/.limit) all return the same promise.
function makeQuery(): Promise<unknown> {
  const result = resultQueue.shift() ?? [];
  const p = Promise.resolve(result) as Promise<unknown> & Record<string, () => unknown>;
  for (const m of ["from", "where", "orderBy", "limit"]) {
    p[m] = () => p;
  }
  return p;
}

vi.mock("../db/index", () => ({ db: { select: () => makeQuery() } }));

import { weatherRoutes } from "../routes/weather";

function createApp() {
  const app = new Hono();
  app.route("/api/weather", weatherRoutes);
  return app;
}

const AREA = {
  officeCode: "130000",
  name: "東京都",
  centerCode: "010300",
  centerName: "関東甲信地方",
  sortOrder: 190,
};
const FORECAST = {
  officeCode: "130000",
  forecastDate: "2026-06-20",
  weatherCode: "100",
  pop: 10,
  tempMin: 20,
  tempMax: 28,
  reliability: null,
  reportDatetime: new Date("2026-06-19T11:00:00+09:00"),
};

beforeEach(() => {
  vi.clearAllMocks();
  resultQueue.length = 0;
  mockGetSession.mockResolvedValue({ user: { id: "user-1" }, session: {} });
});

describe("GET /api/weather/overview", () => {
  it("returns the latest report time for the freshness line", async () => {
    resultQueue.push([{ reportDatetime: new Date("2026-06-19T11:00:00+09:00") }]); // max() aggregate

    const res = await createApp().request("/api/weather/overview");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reportDatetime).toBe("2026-06-19T02:00:00.000Z");
  });

  it("returns reportDatetime null when no forecast is stored yet", async () => {
    resultQueue.push([{ reportDatetime: null }]); // max() of an empty table

    const res = await createApp().request("/api/weather/overview");

    const body = await res.json();
    expect(body.reportDatetime).toBeNull();
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await createApp().request("/api/weather/overview");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/weather/:officeCode", () => {
  it("returns the office's upcoming days", async () => {
    resultQueue.push([AREA]); // area lookup
    resultQueue.push([FORECAST]); // forecasts

    const res = await createApp().request("/api/weather/130000");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.officeCode).toBe("130000");
    expect(body.reportDatetime).toBe("2026-06-19T02:00:00.000Z");
    expect(body.days).toHaveLength(1);
    expect(body.days[0].date).toBe("2026-06-20");
  });

  it("returns 404 for an unknown office", async () => {
    resultQueue.push([]); // area lookup empty

    const res = await createApp().request("/api/weather/999999");

    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed office code without hitting the DB", async () => {
    const res = await createApp().request("/api/weather/abc");

    expect(res.status).toBe(400);
    expect(resultQueue.length).toBe(0); // no DB query was consumed
  });

  it("returns empty days (reportDatetime null) when no forecast stored", async () => {
    resultQueue.push([AREA]); // area lookup
    resultQueue.push([]); // no forecasts

    const res = await createApp().request("/api/weather/130000");

    const body = await res.json();
    expect(body.days).toEqual([]);
    expect(body.reportDatetime).toBeNull();
  });
});
