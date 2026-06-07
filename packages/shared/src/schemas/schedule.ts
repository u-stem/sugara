import { z } from "zod";
import { httpUrlSchema } from "./url";

export const scheduleCategorySchema = z.enum([
  "sightseeing",
  "restaurant",
  "hotel",
  "transport",
  "activity",
  "other",
]);
export type ScheduleCategory = z.infer<typeof scheduleCategorySchema>;

export const SCHEDULE_COLORS = [
  "blue",
  "red",
  "green",
  "yellow",
  "purple",
  "pink",
  "orange",
  "gray",
] as const;
export const scheduleColorSchema = z.enum(SCHEDULE_COLORS);
export type ScheduleColor = z.infer<typeof scheduleColorSchema>;

export const transportMethodSchema = z.enum([
  "train",
  "shinkansen",
  "bus",
  "taxi",
  "walk",
  "car",
  "airplane",
  "bicycle",
  "ropeway",
  "cable_car",
  "ferry",
]);
export type TransportMethod = z.infer<typeof transportMethodSchema>;

// Upper bound guards against typos / overflow; transit fares never reach this.
// cost is a whole-unit planning fare estimate in the trip currency (e.g. 580 = ¥580 / $580),
// a separate unit system from expenses.amount (minor units, scaled by 10^decimals).
export const SCHEDULE_MAX_COST = 99_999_999;

const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;
function isValidTime(val: string): boolean {
  const parts = val.split(":").map(Number);
  const [h, m] = parts;
  if (h < 0 || h > 23 || m < 0 || m > 59) return false;
  if (parts.length === 3 && (parts[2] < 0 || parts[2] > 59)) return false;
  return true;
}
const timeSchema = z
  .string()
  .regex(timeRegex, "Invalid time format")
  .refine(isValidTime, "Time out of range");

export const SCHEDULE_NAME_MAX_LENGTH = 200;
export const SCHEDULE_ADDRESS_MAX_LENGTH = 500;
export const SCHEDULE_MEMO_MAX_LENGTH = 2000;
export const SCHEDULE_URL_MAX_LENGTH = 2000;
export const MAX_URLS_PER_SCHEDULE = 5;
export const SCHEDULE_PLACE_MAX_LENGTH = 200;
export const MAX_END_DAY_OFFSET = 30;

const singleUrlSchema = httpUrlSchema(SCHEDULE_URL_MAX_LENGTH);

const urlsSchema = z
  .array(singleUrlSchema)
  .max(MAX_URLS_PER_SCHEDULE)
  .refine((arr) => new Set(arr).size === arr.length, "Duplicate URLs are not allowed")
  .default([]);

export const createScheduleSchema = z.object({
  name: z.string().min(1).max(SCHEDULE_NAME_MAX_LENGTH),
  category: scheduleCategorySchema,
  address: z.string().max(SCHEDULE_ADDRESS_MAX_LENGTH).nullish(),
  startTime: timeSchema.nullish(),
  endTime: timeSchema.nullish(),
  memo: z.string().max(SCHEDULE_MEMO_MAX_LENGTH).nullish(),
  urls: urlsSchema,
  departurePlace: z.string().max(SCHEDULE_PLACE_MAX_LENGTH).nullish(),
  arrivalPlace: z.string().max(SCHEDULE_PLACE_MAX_LENGTH).nullish(),
  transportMethod: transportMethodSchema.nullish(),
  cost: z.number().int().nonnegative().max(SCHEDULE_MAX_COST).nullish(),
  color: scheduleColorSchema.default("blue"),
  endDayOffset: z.number().int().min(1).max(MAX_END_DAY_OFFSET).nullish(),
  crossDayAnchor: z.enum(["before", "after"]).nullable().optional(),
  crossDayAnchorSourceId: z.string().check(z.guid()).nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  placeId: z.string().max(255).nullable().optional(),
});
export const updateScheduleSchema = createScheduleSchema.partial().extend({
  expectedUpdatedAt: z.string().datetime().optional(),
});

import { MAX_SCHEDULES_PER_TRIP } from "../limits";

export const reorderSchedulesSchema = z
  .object({
    scheduleIds: z.array(z.string().check(z.guid())).max(MAX_SCHEDULES_PER_TRIP),
    anchors: z
      .array(
        z.object({
          scheduleId: z.string().check(z.guid()),
          anchor: z.enum(["before", "after"]).nullable(),
          anchorSourceId: z.string().check(z.guid()).nullable(),
        }),
      )
      .optional(),
    clearAnchors: z.boolean().optional(),
  })
  // anchors / clearAnchors are defined to operate on scheduleIds; an empty
  // scheduleIds with either flag would be a silent no-op that misleads
  // callers into thinking the operation succeeded. Reject at the boundary.
  .refine(
    (v) => {
      if (v.scheduleIds.length > 0) return true;
      if (v.clearAnchors) return false;
      if (v.anchors && v.anchors.length > 0) return false;
      return true;
    },
    { message: "scheduleIds must be non-empty when clearAnchors or anchors is provided" },
  );

export const createCandidateSchema = createScheduleSchema;

export const assignCandidateSchema = z.object({
  dayPatternId: z.string().check(z.guid()),
});

export const batchAssignCandidatesSchema = z.object({
  scheduleIds: z.array(z.string().check(z.guid())).min(1),
  dayPatternId: z.string().check(z.guid()),
});

export const batchScheduleIdsSchema = z.object({
  scheduleIds: z.array(z.string().check(z.guid())).min(1),
});

// Backward-compatible aliases
export const batchUnassignSchedulesSchema = batchScheduleIdsSchema;
export const batchDeleteSchedulesSchema = batchScheduleIdsSchema;

export const batchShiftSchedulesSchema = z.object({
  scheduleIds: z.array(z.string().check(z.guid())).min(1),
  deltaMinutes: z
    .number()
    .int()
    .min(-1440)
    .max(1440)
    .refine((v) => v !== 0, "deltaMinutes must be non-zero"),
});

export const REACTION_TYPES = ["like", "hmm"] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const reactionSchema = z.object({
  type: z.enum(REACTION_TYPES),
});
