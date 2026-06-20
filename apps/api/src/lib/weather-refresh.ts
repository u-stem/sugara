import type { WeatherRefreshResult } from "@sugara/shared";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db/index";
import { weatherForecasts } from "../db/schema";
import { WEATHER_AREAS, type WeatherAreaSeed } from "../db/weather-areas-data";
import type { ParsedForecast } from "./jma-weather";
import { fetchOfficeForecast } from "./jma-weather";
import { logger } from "./logger";

export type { WeatherRefreshResult };

// Fetch a handful of offices at a time: bounded enough to stay polite to the
// unofficial JMA endpoint, parallel enough to finish well inside the function
// timeout even if several offices hit the per-request timeout. Only the network
// fetch is parallel — the DB writes are strictly sequential (see persistOffice).
const FETCH_CONCURRENCY = 6;

// Time budget for a single run, well under the route's 60s maxDuration. The
// deadline is only checked between batches, so a run can overshoot by one batch
// (~8s fetch timeout + ~3s sequential writes ≈ 11s); 45s + 11s stays < 60s.
export const WEATHER_REFRESH_BUDGET_MS = 45_000;

// Fetch one office's forecast (network only, no DB). Returns null on any fetch /
// parse failure so the office is simply skipped and keeps its prior stored data.
async function fetchOffice(area: WeatherAreaSeed): Promise<ParsedForecast | null> {
  return fetchOfficeForecast(area.forecastOffice ?? area.officeCode, area.areaCode);
}

// Persist one office's forecast: upsert this week + prune older rows in a single
// transaction. Returns whether it was written. Runs ONE AT A TIME: concurrent
// transactions through Supabase's Transaction Pooler (Supavisor) stall in
// ClientRead and hang the whole run (same gotcha documented in admin.ts), which
// is what was leaving the daily refresh stuck after only a few offices.
async function persistOffice(officeCode: string, parsed: ParsedForecast): Promise<boolean> {
  if (parsed.days.length === 0) return false;
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

  try {
    // One transaction so a reader never sees a half-updated office and a mid-way
    // DB error rolls back cleanly.
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

// Start of the current day in JST, as a UTC Date. An office whose rows were
// updated at/after this instant has already been refreshed today.
function jstStartOfTodayUtc(): Date {
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const utcMidnight = Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate());
  return new Date(utcMidnight - 9 * 60 * 60 * 1000);
}

// Office codes already refreshed today (so onlyStale runs can skip them).
async function freshOfficeCodes(since: Date): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ officeCode: weatherForecasts.officeCode })
    .from(weatherForecasts)
    .where(gte(weatherForecasts.updatedAt, since));
  return new Set(rows.map((r) => r.officeCode));
}

// Refresh offices' weekly forecasts from JMA and upsert into the DB.
//
// Iterates the office master constant (so the fetch mapping for sub-area offices
// is available), fetching in small concurrent batches but writing sequentially.
// An office that fails to fetch, parse, or persist is skipped; one failure never
// aborts the run.
//
// onlyStale: skip offices already refreshed today (used by the daily cron and
//   the admin "continue" action so re-runs converge on the leftovers).
// deadlineMs: epoch ms to stop starting new offices by, leaving the rest as
//   `remaining`. Keeps a single run inside the function's maxDuration; the next
//   run (cron or admin) finishes the rest.
export async function refreshAllWeather({
  areas = WEATHER_AREAS,
  onlyStale = false,
  deadlineMs,
}: {
  areas?: WeatherAreaSeed[];
  onlyStale?: boolean;
  deadlineMs?: number;
} = {}): Promise<WeatherRefreshResult> {
  let target = areas;
  if (onlyStale) {
    const fresh = await freshOfficeCodes(jstStartOfTodayUtc());
    target = areas.filter((a) => !fresh.has(a.officeCode));
  }

  let updated = 0;
  let processed = 0;
  for (let i = 0; i < target.length; i += FETCH_CONCURRENCY) {
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) break;
    const batch = target.slice(i, i + FETCH_CONCURRENCY);
    const fetched = await Promise.all(batch.map(fetchOffice));
    // Sequential DB writes (see persistOffice) — never Promise.all these.
    for (let j = 0; j < batch.length; j++) {
      const parsed = fetched[j];
      processed++;
      if (parsed && (await persistOffice(batch[j].officeCode, parsed))) updated++;
    }
  }

  const skipped = processed - updated;
  const remaining = target.length - processed;
  logger.info(
    { updated, skipped, remaining, total: areas.length, onlyStale },
    "weather refresh complete",
  );
  return { updated, skipped, remaining, total: areas.length };
}
