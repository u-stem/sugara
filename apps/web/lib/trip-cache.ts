import type { CandidateResponse, ScheduleResponse, TripResponse } from "@sugara/shared";

// Compile-time check: ensures SCHEDULE_FIELDS covers all keys of ScheduleResponse.
// Adding a field to ScheduleResponse without updating this record causes a type error.
const _fieldCheck: Record<keyof ScheduleResponse, true> = {
  id: true,
  name: true,
  category: true,
  address: true,
  startTime: true,
  endTime: true,
  sortOrder: true,
  memo: true,
  urls: true,
  departurePlace: true,
  arrivalPlace: true,
  transportMethod: true,
  cost: true,
  color: true,
  endDayOffset: true,
  crossDayAnchor: true,
  crossDayAnchorSourceId: true,
  latitude: true,
  longitude: true,
  placeId: true,
  updatedAt: true,
};

const SCHEDULE_FIELDS = Object.keys(_fieldCheck) as (keyof ScheduleResponse)[];

/** Extract ScheduleResponse fields from a raw DB row. */
export function toScheduleResponse(raw: Record<string, unknown>): ScheduleResponse {
  const result: Record<string, unknown> = {};
  for (const key of SCHEDULE_FIELDS) {
    if (key in raw) {
      result[key] = raw[key];
    }
  }
  return result as ScheduleResponse;
}

/** Convert a raw DB row to CandidateResponse with zero reaction counts. */
export function toCandidateResponse(raw: Record<string, unknown>): CandidateResponse {
  return {
    ...toScheduleResponse(raw),
    likeCount: 0,
    hmmCount: 0,
    myReaction: null,
  };
}

// --- Schedule operations (day > pattern > schedules) ---

export function addScheduleToPattern(
  trip: TripResponse,
  dayId: string,
  patternId: string,
  schedule: ScheduleResponse,
): TripResponse {
  const dayIndex = trip.days.findIndex((d) => d.id === dayId);
  if (dayIndex === -1) return trip;

  const patternIndex = trip.days[dayIndex].patterns.findIndex((p) => p.id === patternId);
  if (patternIndex === -1) return trip;

  return {
    ...trip,
    scheduleCount: trip.scheduleCount + 1,
    days: trip.days.map((day, di) =>
      di !== dayIndex
        ? day
        : {
            ...day,
            patterns: day.patterns.map((pattern, pi) =>
              pi !== patternIndex
                ? pattern
                : { ...pattern, schedules: [...pattern.schedules, schedule] },
            ),
          },
    ),
  };
}

export function updateScheduleInPattern(
  trip: TripResponse,
  dayId: string,
  patternId: string,
  scheduleId: string,
  updated: ScheduleResponse,
): TripResponse {
  return {
    ...trip,
    days: trip.days.map((day) =>
      day.id !== dayId
        ? day
        : {
            ...day,
            patterns: day.patterns.map((pattern) =>
              pattern.id !== patternId
                ? pattern
                : {
                    ...pattern,
                    schedules: pattern.schedules.map((s) => (s.id === scheduleId ? updated : s)),
                  },
            ),
          },
    ),
  };
}

export function removeScheduleFromPattern(
  trip: TripResponse,
  dayId: string,
  patternId: string,
  scheduleId: string,
): TripResponse {
  const day = trip.days.find((d) => d.id === dayId);
  if (!day) return trip;
  const pattern = day.patterns.find((p) => p.id === patternId);
  if (!pattern) return trip;
  if (!pattern.schedules.some((s) => s.id === scheduleId)) return trip;

  return {
    ...trip,
    scheduleCount: trip.scheduleCount - 1,
    days: trip.days.map((d) =>
      d.id !== dayId
        ? d
        : {
            ...d,
            patterns: d.patterns.map((p) =>
              p.id !== patternId
                ? p
                : { ...p, schedules: p.schedules.filter((s) => s.id !== scheduleId) },
            ),
          },
    ),
  };
}

// --- Candidate operations (trip.candidates) ---

export function addCandidate(trip: TripResponse, candidate: CandidateResponse): TripResponse {
  return {
    ...trip,
    scheduleCount: trip.scheduleCount + 1,
    candidates: [...trip.candidates, candidate],
  };
}

export function updateCandidate(
  trip: TripResponse,
  scheduleId: string,
  updated: CandidateResponse,
): TripResponse {
  return {
    ...trip,
    candidates: trip.candidates.map((c) =>
      c.id === scheduleId
        ? { ...updated, likeCount: c.likeCount, hmmCount: c.hmmCount, myReaction: c.myReaction }
        : c,
    ),
  };
}

export function removeCandidate(trip: TripResponse, scheduleId: string): TripResponse {
  if (!trip.candidates.some((c) => c.id === scheduleId)) return trip;

  return {
    ...trip,
    scheduleCount: trip.scheduleCount - 1,
    candidates: trip.candidates.filter((c) => c.id !== scheduleId),
  };
}

// --- Move operations (scheduleCount unchanged) ---

/**
 * Move a schedule from a pattern to candidates.
 * Uses `serverData` (from API response) for sortOrder/updatedAt if provided,
 * otherwise falls back to the cached schedule data.
 */
export function moveScheduleToCandidate(
  trip: TripResponse,
  dayId: string,
  patternId: string,
  scheduleId: string,
  serverData?: ScheduleResponse,
): TripResponse {
  const day = trip.days.find((d) => d.id === dayId);
  if (!day) return trip;
  const pattern = day.patterns.find((p) => p.id === patternId);
  if (!pattern) return trip;
  const schedule = pattern.schedules.find((s) => s.id === scheduleId);
  if (!schedule) return trip;

  const base = serverData ?? schedule;
  const candidate: CandidateResponse = {
    ...base,
    likeCount: 0,
    hmmCount: 0,
    myReaction: null,
  };

  return {
    ...trip,
    days: trip.days.map((d) =>
      d.id !== dayId
        ? d
        : {
            ...d,
            patterns: d.patterns.map((p) =>
              p.id !== patternId
                ? p
                : { ...p, schedules: p.schedules.filter((s) => s.id !== scheduleId) },
            ),
          },
    ),
    candidates: [...trip.candidates, candidate],
  };
}

/**
 * Move a candidate to a pattern as a schedule.
 * Uses `serverData` (from API response) for sortOrder/updatedAt if provided,
 * otherwise falls back to the cached candidate data.
 */
export function moveCandidateToSchedule(
  trip: TripResponse,
  candidateId: string,
  dayId: string,
  patternId: string,
  serverData?: ScheduleResponse,
): TripResponse {
  const candidate = trip.candidates.find((c) => c.id === candidateId);
  if (!candidate) return trip;

  const schedule: ScheduleResponse =
    serverData ??
    (() => {
      const { likeCount: _, hmmCount: __, myReaction: ___, ...rest } = candidate;
      return rest;
    })();

  return {
    ...trip,
    candidates: trip.candidates.filter((c) => c.id !== candidateId),
    days: trip.days.map((d) =>
      d.id !== dayId
        ? d
        : {
            ...d,
            patterns: d.patterns.map((p) =>
              p.id !== patternId ? p : { ...p, schedules: [...p.schedules, schedule] },
            ),
          },
    ),
  };
}
