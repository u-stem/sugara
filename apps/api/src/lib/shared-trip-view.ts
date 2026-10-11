import type { SharedTripResponse } from "@sugara/shared";
import type { dayPatterns, schedules, tripDays, trips } from "../db/schema";
import { deriveShareChannelKey } from "./share-token";

type ScheduleRow = typeof schedules.$inferSelect;
type PatternRow = typeof dayPatterns.$inferSelect & { schedules: ScheduleRow[] };
type DayRow = typeof tripDays.$inferSelect & { patterns: PatternRow[] };
type TripRow = typeof trips.$inferSelect & { days: DayRow[]; schedules: ScheduleRow[] };

type SharedSchedule = SharedTripResponse["candidates"][number];

// Every field is listed explicitly (no spread of a DB row) so that internal ids such
// as tripId / dayPatternId / tripDayId and any column added later stay out of the
// unauthenticated response unless someone opts them in here and in the shared schema.
// This is defence in depth, not a way to keep the trip id secret from viewers: the cover
// image storage path (${tripId}/...) in coverImageUrl still contains it. Preventing
// strangers from joining the members' Realtime channel trip:<tripId> requires private
// channels (designed separately, Phase 3).
function toSharedSchedule(s: ScheduleRow): SharedSchedule {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    address: s.address,
    startTime: s.startTime,
    endTime: s.endTime,
    sortOrder: s.sortOrder,
    memo: s.memo,
    urls: s.urls,
    departurePlace: s.departurePlace,
    arrivalPlace: s.arrivalPlace,
    transportMethod: s.transportMethod,
    cost: s.cost,
    color: s.color,
    endDayOffset: s.endDayOffset,
    crossDayAnchor: s.crossDayAnchor,
    crossDayAnchorSourceId: s.crossDayAnchorSourceId,
    latitude: s.latitude,
    longitude: s.longitude,
    placeId: s.placeId,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toSharedTripResponse(trip: TripRow, token: string): SharedTripResponse {
  return {
    title: trip.title,
    destination: trip.destination,
    startDate: trip.startDate,
    endDate: trip.endDate,
    status: trip.status,
    coverImageUrl: trip.coverImageUrl,
    coverImagePosition: trip.coverImagePosition,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
    days: trip.days.map((day) => ({
      id: day.id,
      dayNumber: day.dayNumber,
      date: day.date,
      memo: day.memo,
      weatherType: day.weatherType,
      weatherTypeSecondary: day.weatherTypeSecondary,
      tempHigh: day.tempHigh,
      tempLow: day.tempLow,
      patterns: day.patterns.map((pattern) => ({
        id: pattern.id,
        label: pattern.label,
        isDefault: pattern.isDefault,
        sortOrder: pattern.sortOrder,
        schedules: pattern.schedules.map(toSharedSchedule),
      })),
    })),
    // Candidates are schedules not assigned to any day pattern
    candidates: trip.schedules.filter((s) => s.dayPatternId == null).map(toSharedSchedule),
    shareExpiresAt: trip.shareTokenExpiresAt?.toISOString() ?? null,
    // Same value members receive from the trip detail API; lets viewers subscribe to
    // edit notifications without the token ever being used as a channel name.
    shareChannelKey: deriveShareChannelKey(token),
  };
}
