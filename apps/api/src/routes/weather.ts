import {
  jstToday,
  type WeatherDay,
  type WeatherDetailResponse,
  type WeatherOverviewResponse,
} from "@sugara/shared";
import { and, asc, eq, gte, max } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { weatherAreas, weatherForecasts } from "../db/schema";
import { RATE_LIMIT_PUBLIC_RESOURCE } from "../lib/constants";
import { requireAuth } from "../middleware/auth";
import { rateLimitByIp } from "../middleware/rate-limit";
import type { AppEnv } from "../types";

export const weatherRoutes = new Hono<AppEnv>();

const weatherRateLimit = rateLimitByIp(RATE_LIMIT_PUBLIC_RESOURCE);

// JMA office codes are 6 digits (e.g. "130000"); reject anything else early.
const OFFICE_CODE_RE = /^\d{6}$/;

type ForecastRow = typeof weatherForecasts.$inferSelect;

function toWeatherDay(row: ForecastRow): WeatherDay {
  return {
    date: row.forecastDate,
    weatherCode: row.weatherCode,
    pop: row.pop,
    tempMin: row.tempMin,
    tempMax: row.tempMax,
    reliability: row.reliability,
  };
}

// GET /api/weather/overview - the office list is a static client-side navigator,
// so this only returns the latest JMA issue time for the tool's freshness line.
weatherRoutes.get("/overview", requireAuth, weatherRateLimit, async (c) => {
  // Cheap aggregate (not a full scan of rows) for the tool's freshness line.
  const [latest] = await db
    .select({ reportDatetime: max(weatherForecasts.reportDatetime) })
    .from(weatherForecasts);

  const body: WeatherOverviewResponse = {
    reportDatetime: latest?.reportDatetime?.toISOString() ?? null,
  };
  return c.json(body);
});

// GET /api/weather/:officeCode - one office's upcoming weekly forecast.
weatherRoutes.get("/:officeCode", requireAuth, weatherRateLimit, async (c) => {
  const officeCode = c.req.param("officeCode");
  if (!officeCode || !OFFICE_CODE_RE.test(officeCode)) {
    return c.json({ error: "Invalid office code" }, 400);
  }
  const area = await db
    .select()
    .from(weatherAreas)
    .where(eq(weatherAreas.officeCode, officeCode))
    .limit(1);
  if (area.length === 0) {
    return c.json({ error: "Unknown weather area" }, 404);
  }

  const today = jstToday();
  const rows = await db
    .select()
    .from(weatherForecasts)
    .where(
      and(eq(weatherForecasts.officeCode, officeCode), gte(weatherForecasts.forecastDate, today)),
    )
    .orderBy(asc(weatherForecasts.forecastDate))
    .limit(7);

  const body: WeatherDetailResponse = {
    officeCode: area[0].officeCode,
    name: area[0].name,
    centerName: area[0].centerName,
    reportDatetime: rows[0]?.reportDatetime.toISOString() ?? null,
    days: rows.map(toWeatherDay),
  };
  return c.json(body);
});
