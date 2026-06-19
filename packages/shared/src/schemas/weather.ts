import { z } from "zod";

// One day of weekly forecast. Numeric fields are nullable because the JMA
// weekly feed leaves the boundary day's pop/temperature empty.
export const weatherDaySchema = z.object({
  date: z.string(), // ISO date (JST), e.g. "2026-06-20"
  weatherCode: z.string(),
  pop: z.number().nullable(), // probability of precipitation, %
  tempMin: z.number().nullable(),
  tempMax: z.number().nullable(),
  reliability: z.string().nullable(), // weekly forecast reliability A/B/C, "" -> null
});
export type WeatherDay = z.infer<typeof weatherDaySchema>;

// The nationwide overview is a static navigator rendered client-side; the API
// only supplies the latest JMA issue time for the tool's freshness/source line.
// Null until the cron has populated data.
export const weatherOverviewResponseSchema = z.object({
  reportDatetime: z.string().nullable(),
});
export type WeatherOverviewResponse = z.infer<typeof weatherOverviewResponseSchema>;

export const weatherDetailResponseSchema = z.object({
  officeCode: z.string(),
  name: z.string(),
  centerName: z.string(),
  reportDatetime: z.string().nullable(), // null when no data yet
  days: z.array(weatherDaySchema),
});
export type WeatherDetailResponse = z.infer<typeof weatherDetailResponseSchema>;
