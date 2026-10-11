import { z } from "zod";
import { scheduleCategorySchema, scheduleColorSchema, transportMethodSchema } from "./schedule";
import { tripStatusSchema } from "./trip";
import { WEATHER_TYPES } from "./trip-day";

// Response contract of the unauthenticated GET /api/shared/:token.
// Every object is strict on purpose: a key that is not listed here (tripId,
// dayPatternId, tripDayId, user ids, ...) must never reach shared-link viewers,
// so adding a DB column cannot leak it by accident. Ids that remain (day / pattern /
// schedule ids) are only used as React keys and cross-day anchors in the viewer.
// NOTE: this does not hide the trip id completely: coverImageUrl is a storage URL
// that contains it. Protecting the members-only Realtime channel is a separate
// concern (private channels), not something this schema guarantees.

const weatherTypeSchema = z.enum(WEATHER_TYPES);

export const sharedScheduleSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  category: scheduleCategorySchema,
  address: z.string().nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  sortOrder: z.number(),
  memo: z.string().nullable(),
  urls: z.array(z.string()),
  departurePlace: z.string().nullable(),
  arrivalPlace: z.string().nullable(),
  transportMethod: transportMethodSchema.nullable(),
  cost: z.number().nullable(),
  color: scheduleColorSchema,
  endDayOffset: z.number().nullable(),
  crossDayAnchor: z.enum(["before", "after"]).nullable(),
  crossDayAnchorSourceId: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  placeId: z.string().nullable(),
  updatedAt: z.string(),
});

export const sharedDayPatternSchema = z.strictObject({
  id: z.string(),
  label: z.string(),
  isDefault: z.boolean(),
  sortOrder: z.number(),
  schedules: z.array(sharedScheduleSchema),
});

export const sharedDaySchema = z.strictObject({
  id: z.string(),
  dayNumber: z.number(),
  date: z.string(),
  memo: z.string().nullable(),
  weatherType: weatherTypeSchema.nullable(),
  weatherTypeSecondary: weatherTypeSchema.nullable(),
  tempHigh: z.number().nullable(),
  tempLow: z.number().nullable(),
  patterns: z.array(sharedDayPatternSchema),
});

export const sharedTripResponseSchema = z.strictObject({
  title: z.string(),
  destination: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: tripStatusSchema,
  coverImageUrl: z.string().nullable(),
  coverImagePosition: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  days: z.array(sharedDaySchema),
  candidates: z.array(sharedScheduleSchema),
  shareExpiresAt: z.string().nullable(),
  /** SHA-256 (hex) of the share token; names the Realtime channel for edit notifications. */
  shareChannelKey: z.string(),
});

export type SharedTripResponse = z.infer<typeof sharedTripResponseSchema>;
