import type { WeatherDay } from "@sugara/shared";
import { logger } from "./logger";

// JMA forecast feed: https://www.jma.go.jp/bosai/forecast/data/forecast/{office}.json
// No API key, no documented rate limit. Unofficial endpoint, so parsing is
// defensive: any structural surprise yields null and the caller skips the
// office (keeping yesterday's stored data) rather than throwing.
const forecastUrl = (officeCode: string) =>
  `https://www.jma.go.jp/bosai/forecast/data/forecast/${officeCode}.json`;

// A real forecast is tens of KB; cap the body to defend against an unexpectedly
// huge response from this unofficial endpoint.
const MAX_FORECAST_BYTES = 5_000_000;

export type ParsedForecast = {
  reportDatetime: string;
  days: WeatherDay[];
};

// JST timestamps carry a +09:00 offset, so the leading 10 chars are already the
// JST calendar date.
function jstDate(iso: string): string {
  return iso.slice(0, 10);
}

function intOrNull(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

// Index of the weekly area matching areaCode, or 0 (the representative area) when
// no code is given or no match is found.
function resolveAreaIndex(areas: unknown, areaCode: string | undefined): number {
  if (!areaCode || !Array.isArray(areas)) return 0;
  const idx = areas.findIndex((a) => a?.area?.code === areaCode);
  return idx >= 0 ? idx : 0;
}

type MutableDay = {
  weatherCode: string;
  pop: number | null;
  tempMin: number | null;
  tempMax: number | null;
  reliability: string | null;
};

// Parse the raw JMA forecast JSON into a clean weekly series.
//
// Precedence: the 3-day detailed forecast (raw[0]) wins for the days it covers
// (today..+2) for weather code and probability of precipitation; the weekly
// forecast (raw[1]) provides the rest and the cleaner min/max temperatures. The
// weekly feed's boundary day has empty pop/temps, which the 3-day fills.
//
// areaCode selects a non-representative weekly area within a shared file. A few
// offices (e.g. 十勝/奄美) have no standalone endpoint and live as a secondary
// area inside a parent office's file. We locate that area by code in the weekly
// weather series and reuse its index for the (point-coded) temperature series,
// which lines up in practice. For these offices the 3-day enrichment is skipped
// because the 3-day file partitions sub-areas differently; the weekly series is
// used as-is. Omit areaCode for normal offices to use the representative area[0].
//
// Returns null when the essential weekly weather codes are missing.
export function parseForecast(raw: unknown, areaCode?: string): ParsedForecast | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const threeDay = raw[0];
  const weekly = raw[1];

  const weeklyWeatherTs = weekly?.timeSeries?.[0];
  const weeklyAreas = weeklyWeatherTs?.areas;
  const areaIndex = resolveAreaIndex(weeklyAreas, areaCode);
  const weeklyArea = weeklyAreas?.[areaIndex];
  const weeklyDates = weeklyWeatherTs?.timeDefines;
  const weeklyCodes = weeklyArea?.weatherCodes;
  if (!isStringArray(weeklyDates) || !isStringArray(weeklyCodes) || weeklyDates.length === 0) {
    return null;
  }

  const byDate = new Map<string, MutableDay>();

  // Pass 1: weekly forecast fills the canonical week.
  const weeklyPops = isStringArray(weeklyArea?.pops) ? weeklyArea.pops : [];
  const weeklyRel = isStringArray(weeklyArea?.reliabilities) ? weeklyArea.reliabilities : [];
  for (let i = 0; i < weeklyDates.length; i++) {
    const date = jstDate(weeklyDates[i]);
    byDate.set(date, {
      weatherCode: weeklyCodes[i] ?? "",
      pop: intOrNull(weeklyPops[i]),
      tempMin: null,
      tempMax: null,
      reliability: weeklyRel[i]?.trim() ? weeklyRel[i] : null,
    });
  }
  const weeklyTempTs = weekly?.timeSeries?.[1];
  const weeklyTempArea = weeklyTempTs?.areas?.[areaIndex];
  const weeklyTempDates = weeklyTempTs?.timeDefines;
  if (isStringArray(weeklyTempDates)) {
    const tempsMin = isStringArray(weeklyTempArea?.tempsMin) ? weeklyTempArea.tempsMin : [];
    const tempsMax = isStringArray(weeklyTempArea?.tempsMax) ? weeklyTempArea.tempsMax : [];
    for (let i = 0; i < weeklyTempDates.length; i++) {
      const entry = byDate.get(jstDate(weeklyTempDates[i]));
      if (!entry) continue;
      entry.tempMin = intOrNull(tempsMin[i]);
      entry.tempMax = intOrNull(tempsMax[i]);
    }
  }

  // Pass 2: 3-day detailed forecast overrides weather/pop for near-term days and
  // adds today (which the weekly feed omits). Temps only fill gaps the weekly
  // left empty (the weekly min/max are cleaner when present). Skipped for offices
  // resolved by areaCode, whose 3-day file partitions sub-areas differently.
  const threeWeatherTs = areaCode ? undefined : threeDay?.timeSeries?.[0];
  const threeWeatherArea = threeWeatherTs?.areas?.[0];
  const threeDates = threeWeatherTs?.timeDefines;
  const threeCodes = threeWeatherArea?.weatherCodes;
  if (isStringArray(threeDates) && isStringArray(threeCodes)) {
    const threeDayPop = aggregatePopByDate(threeDay?.timeSeries?.[1]);
    const threeDayTemp = aggregateTempByDate(threeDay?.timeSeries?.[2]);
    for (let i = 0; i < threeDates.length; i++) {
      const date = jstDate(threeDates[i]);
      const existing = byDate.get(date);
      const entry: MutableDay = existing ?? {
        weatherCode: "",
        pop: null,
        tempMin: null,
        tempMax: null,
        reliability: null,
      };
      entry.weatherCode = threeCodes[i] ?? entry.weatherCode;
      const pop = threeDayPop.get(date);
      if (pop != null) entry.pop = pop;
      const temp = threeDayTemp.get(date);
      if (temp) {
        if (entry.tempMax == null) entry.tempMax = temp.max;
        // Only fill tempMin when it differs from tempMax. The 3-day series often
        // has a single spot reading for today (the morning low has already
        // passed), which would otherwise surface as a misleading "30°/30°".
        if (entry.tempMin == null && temp.min !== temp.max) entry.tempMin = temp.min;
      }
      // Only new dates (today, which the weekly feed omits) need inserting;
      // existing entries were mutated in place above.
      if (!existing) byDate.set(date, entry);
    }
  }

  const reportDatetime =
    typeof weekly?.reportDatetime === "string"
      ? weekly.reportDatetime
      : typeof threeDay?.reportDatetime === "string"
        ? threeDay.reportDatetime
        : null;
  if (reportDatetime === null) return null;

  const days: WeatherDay[] = [...byDate.entries()]
    // Drop days whose weather code never got filled (a missing JMA element would
    // otherwise persist as "" and surface downstream as a silent "不明").
    .filter(([, d]) => d.weatherCode.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 7)
    .map(([date, d]) => ({ date, ...d }));

  return { reportDatetime, days };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Extract aligned timeDefines + a named string[] field from the first area of a
// JMA timeSeries object, using type guards instead of casts. Returns null when
// the shape is unexpected.
function firstAreaField(ts: unknown, field: string): { dates: string[]; values: string[] } | null {
  if (!isObject(ts)) return null;
  const dates = ts.timeDefines;
  const first = Array.isArray(ts.areas) ? ts.areas[0] : undefined;
  const values = isObject(first) ? first[field] : undefined;
  if (!isStringArray(dates) || !isStringArray(values)) return null;
  return { dates, values };
}

// 3-day pop is reported in 6-hour buckets; take the day's max as the daily pop.
function aggregatePopByDate(popTs: unknown): Map<string, number> {
  const result = new Map<string, number>();
  const data = firstAreaField(popTs, "pops");
  if (!data) return result;
  for (let i = 0; i < data.dates.length; i++) {
    const pop = intOrNull(data.values[i]);
    if (pop == null) continue;
    const date = jstDate(data.dates[i]);
    result.set(date, Math.max(result.get(date) ?? pop, pop));
  }
  return result;
}

// 3-day temps are spot values at various times; min/max over a day approximates
// the daily low/high. Used only as a fallback when the weekly temps are empty.
function aggregateTempByDate(tempTs: unknown): Map<string, { min: number; max: number }> {
  const result = new Map<string, { min: number; max: number }>();
  const data = firstAreaField(tempTs, "temps");
  if (!data) return result;
  const { dates, values: temps } = data;
  for (let i = 0; i < dates.length; i++) {
    const t = intOrNull(temps[i]);
    if (t == null) continue;
    const date = jstDate(dates[i]);
    const prev = result.get(date);
    result.set(
      date,
      prev ? { min: Math.min(prev.min, t), max: Math.max(prev.max, t) } : { min: t, max: t },
    );
  }
  return result;
}

// Fetch and parse one office's forecast. Returns null on network error, non-OK
// response, or unparseable body so the caller can skip and retain prior data.
// fetchCode is the file to request (a parent office for sub-area offices);
// areaCode selects the sub-area within that file (see parseForecast).
export async function fetchOfficeForecast(
  fetchCode: string,
  areaCode?: string,
): Promise<ParsedForecast | null> {
  try {
    const res = await fetch(forecastUrl(fetchCode), {
      signal: AbortSignal.timeout(8000),
      redirect: "error", // never follow a redirect off the trusted JMA host
      headers: { "User-Agent": "sugara-weather (https://github.com/u-stem/sugara)" },
    });
    if (!res.ok) {
      logger.error({ fetchCode, status: res.status }, "JMA forecast fetch returned non-OK");
      return null;
    }
    // Guard against an unexpectedly huge body from this unofficial endpoint.
    // A real forecast is tens of KB; anything past 5MB is treated as bogus.
    // content-length is an early reject when present; the streaming read below is
    // the real defense (the header can be absent or wrong), counting actual bytes
    // and aborting the moment the cap is crossed instead of buffering it all.
    const contentLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_FORECAST_BYTES) {
      logger.error({ fetchCode, contentLength }, "JMA forecast body too large");
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      logger.error({ fetchCode }, "JMA forecast response had no body");
      return null;
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_FORECAST_BYTES) {
        await reader.cancel();
        logger.error({ fetchCode, received }, "JMA forecast body too large");
        return null;
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf-8");
    return parseForecast(JSON.parse(text), areaCode);
  } catch (err) {
    logger.error({ err, fetchCode }, "Failed to fetch JMA forecast");
    return null;
  }
}
