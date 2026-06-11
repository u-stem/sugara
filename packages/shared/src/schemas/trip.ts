import { z } from "zod";
import { currencyCodeSchema } from "../currency";
import { MAX_OPTIONS_PER_POLL } from "../limits";

export const TRIP_TITLE_MAX_LENGTH = 100;
export const TRIP_DESTINATION_MAX_LENGTH = 100;
export const COVER_IMAGE_URL_MAX_LENGTH = 500;

export const tripStatusSchema = z.enum(["scheduling", "draft", "planned", "active", "completed"]);
export type TripStatus = z.infer<typeof tripStatusSchema>;

// Base object without .refine — allows .omit()/.extend() in v1 adapters.
// The refined schema re-applies the same constraint, so validation is unchanged.
export const createTripBaseSchema = z.object({
  title: z.string().min(1).max(TRIP_TITLE_MAX_LENGTH),
  destination: z.string().max(TRIP_DESTINATION_MAX_LENGTH).optional(),
  coverImageUrl: z.string().url().max(COVER_IMAGE_URL_MAX_LENGTH).optional(),
  coverImagePosition: z.number().int().min(0).max(100).optional(),
  startDate: z.string().date(),
  endDate: z.string().date(),
  currency: currencyCodeSchema.optional().default("JPY"),
});

export const createTripSchema = createTripBaseSchema.refine(
  (data) => data.endDate >= data.startDate,
  {
    message: "End date must be on or after start date",
    path: ["endDate"],
  },
);
// Used when creating a trip with schedule poll mode
export const createTripWithPollSchema = z.object({
  title: z.string().min(1).max(TRIP_TITLE_MAX_LENGTH),
  destination: z.string().max(TRIP_DESTINATION_MAX_LENGTH).optional(),
  coverImageUrl: z.string().url().max(COVER_IMAGE_URL_MAX_LENGTH).optional(),
  coverImagePosition: z.number().int().min(0).max(100).optional(),
  pollOptions: z
    .array(
      z
        .object({
          startDate: z.string().date(),
          endDate: z.string().date(),
        })
        .refine((d) => d.endDate >= d.startDate, {
          message: "End date must be on or after start date",
          path: ["endDate"],
        }),
    )
    .min(1)
    .max(MAX_OPTIONS_PER_POLL),
  currency: currencyCodeSchema.optional().default("JPY"),
});

// Base object without .refine — allows .omit()/.extend() in v1 adapters.
export const updateTripBaseSchema = z.object({
  title: z.string().min(1).max(TRIP_TITLE_MAX_LENGTH).optional(),
  destination: z.string().max(TRIP_DESTINATION_MAX_LENGTH).nullable().optional(),
  status: tripStatusSchema.optional(),
  coverImageUrl: z.string().url().max(COVER_IMAGE_URL_MAX_LENGTH).nullable().optional(),
  coverImagePosition: z.number().int().min(0).max(100).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  currency: currencyCodeSchema.optional(),
});

export const updateTripSchema = updateTripBaseSchema.refine(
  (data) => {
    // Only validates when both dates are provided in the same request.
    // Single-date updates are validated against existing DB values in the route handler.
    if (data.startDate && data.endDate) return data.endDate >= data.startDate;
    return true;
  },
  { message: "End date must be on or after start date", path: ["endDate"] },
);

export type UpdateTripInput = z.infer<typeof updateTripSchema>;
