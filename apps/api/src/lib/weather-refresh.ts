import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/index";
import { weatherForecasts } from "../db/schema";
import { WEATHER_AREAS, type WeatherAreaSeed } from "../db/weather-areas-data";
import { fetchOfficeForecast } from "./jma-weather";
import { logger } from "./logger";

export type RefreshResult = { updated: number; skipped: number; total: number };

// Fetch a handful of offices at a time: bounded enough to stay polite to the
// unofficial JMA endpoint, parallel enough to finish well inside the function
// timeout even if several offices hit the per-request timeout.
const CONCURRENCY = 6;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Refresh one office: fetch + upsert + prune stale rows. Returns whether it was
// updated. All failures (fetch, parse, or DB) are swallowed and counted as a
// skip so one office can never abort the whole run, and the office keeps its
// previously stored forecast.
async function refreshOffice(area: WeatherAreaSeed): Promise<boolean> {
  const officeCode = area.officeCode;
  try {
    const parsed = await fetchOfficeForecast(area.forecastOffice ?? officeCode, area.areaCode);
    if (!parsed || parsed.days.length === 0) return false;

    const reportDatetime = new Date(parsed.reportDatetime);
    const rows = parsed.days.map((d) => ({
      officeCode,
      forecastDate: d.date,
      weatherCode: d.weatherCode,
      pop: d.pop,
      tempMin: d.tempMin,
      tempMax: d.tempMax,
      reliability: d.reliability,
      reportDatetime,
    }));

    // Upsert this week and prune older rows in one transaction so a reader never
    // sees a half-updated office and a mid-way DB error rolls back cleanly.
    await db.transaction(async (tx) => {
      await tx
        .insert(weatherForecasts)
        .values(rows)
        .onConflictDoUpdate({
          target: [weatherForecasts.officeCode, weatherForecasts.forecastDate],
          set: {
            weatherCode: sql`excluded.weather_code`,
            pop: sql`excluded.pop`,
            tempMin: sql`excluded.temp_min`,
            tempMax: sql`excluded.temp_max`,
            reliability: sql`excluded.reliability`,
            reportDatetime: sql`excluded.report_datetime`,
            updatedAt: new Date(),
          },
        });
      await tx
        .delete(weatherForecasts)
        .where(
          and(
            eq(weatherForecasts.officeCode, officeCode),
            lt(weatherForecasts.forecastDate, rows[0].forecastDate),
          ),
        );
    });
    return true;
  } catch (err) {
    logger.error({ err, officeCode }, "weather refresh: office failed, retaining prior data");
    return false;
  }
}

// Refresh every office's weekly forecast from JMA and upsert into the DB.
//
// Iterates the office master constant (so the fetch mapping for sub-area offices
// is available) in small concurrent batches. An office that fails to fetch,
// parse, or persist is skipped; one failure never aborts the run.
export async function refreshAllWeather({
  delayMs = 300,
  areas = WEATHER_AREAS,
}: {
  delayMs?: number;
  areas?: WeatherAreaSeed[];
} = {}): Promise<RefreshResult> {
  let updated = 0;

  for (let i = 0; i < areas.length; i += CONCURRENCY) {
    const batch = areas.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(refreshOffice));
    updated += results.filter(Boolean).length;
    if (delayMs > 0 && i + CONCURRENCY < areas.length) await sleep(delayMs);
  }

  const skipped = areas.length - updated;
  logger.info({ updated, skipped, total: areas.length }, "weather refresh complete");
  return { updated, skipped, total: areas.length };
}
