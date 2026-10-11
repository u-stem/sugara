import { describe, expect, it } from "vitest";
import { sharedTripResponseSchema } from "../schemas/shared-trip";

const schedule = {
  id: "s-1",
  name: "Senso-ji",
  category: "sightseeing",
  address: null,
  startTime: null,
  endTime: null,
  sortOrder: 0,
  memo: null,
  urls: [],
  departurePlace: null,
  arrivalPlace: null,
  transportMethod: null,
  cost: null,
  color: "blue",
  endDayOffset: null,
  crossDayAnchor: null,
  crossDayAnchorSourceId: null,
  latitude: null,
  longitude: null,
  placeId: null,
  updatedAt: "2025-07-01T00:00:00.000Z",
};

const pattern = {
  id: "p-1",
  label: "Default",
  isDefault: true,
  sortOrder: 0,
  schedules: [schedule],
};

const day = {
  id: "d-1",
  dayNumber: 1,
  date: "2025-07-01",
  memo: null,
  weatherType: null,
  weatherTypeSecondary: null,
  tempHigh: null,
  tempLow: null,
  patterns: [pattern],
};

const response = {
  title: "Tokyo Trip",
  destination: "Tokyo",
  startDate: "2025-07-01",
  endDate: "2025-07-01",
  status: "planned",
  coverImageUrl: null,
  coverImagePosition: 50,
  createdAt: "2025-06-01T00:00:00.000Z",
  updatedAt: "2025-06-02T00:00:00.000Z",
  days: [day],
  candidates: [schedule],
  shareExpiresAt: null,
  shareChannelKey: "a".repeat(64),
};

describe("sharedTripResponseSchema", () => {
  it("accepts the documented shared view shape", () => {
    expect(sharedTripResponseSchema.safeParse(response).success).toBe(true);
  });

  it("rejects an extra key on the trip", () => {
    const result = sharedTripResponseSchema.safeParse({ ...response, ownerId: "user-1" });

    expect(result.success).toBe(false);
  });

  it("rejects tripId on a day", () => {
    const result = sharedTripResponseSchema.safeParse({
      ...response,
      days: [{ ...day, tripId: "trip-1" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects tripDayId on a pattern", () => {
    const result = sharedTripResponseSchema.safeParse({
      ...response,
      days: [{ ...day, patterns: [{ ...pattern, tripDayId: "d-1" }] }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects tripId on a scheduled item", () => {
    const result = sharedTripResponseSchema.safeParse({
      ...response,
      days: [{ ...day, patterns: [{ ...pattern, schedules: [{ ...schedule, tripId: "t-1" }] }] }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects dayPatternId on a candidate", () => {
    const result = sharedTripResponseSchema.safeParse({
      ...response,
      candidates: [{ ...schedule, dayPatternId: null }],
    });

    expect(result.success).toBe(false);
  });
});
