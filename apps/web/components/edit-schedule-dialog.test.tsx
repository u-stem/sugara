/**
 * Regression tests for the stale-refetch clobber fix (#155): a successful
 * schedule edit must reconcile the cache with the server-confirmed row and call
 * onSaved() (skip refetch) — never onConflict(). A 409/404 or an evicted cache
 * must fall back to onConflict() so the parent refetches.
 */
import type {
  DayPatternResponse,
  DayResponse,
  ScheduleResponse,
  TripResponse,
} from "@sugara/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query-keys";
import messages from "@/messages/ja.json";

const mockApi = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("sonner");

// Keep the form render free of the Google Maps loader and OGP fetches; the name
// input still renders from defaultValues so the submitted FormData is valid.
vi.mock("@/components/places-autocomplete-input", () => ({
  PlacesAutocompleteInput: ({ id, name, defaultValue }: Record<string, string>) => (
    <input id={id} name={name} defaultValue={defaultValue} />
  ),
}));
vi.mock("@/lib/hooks/use-ogp-autofill", () => ({
  useOgpAutofill: () => ({ onUrlsChange: vi.fn(), titleSuggestion: null }),
}));

import { ApiError } from "@/lib/api";
import { EditScheduleDialog } from "./edit-schedule-dialog";

const TRIP_ID = "trip-1";
const DAY_ID = "d1";
const PATTERN_ID = "p1";
const SCHEDULE_ID = "s1";

function makeSchedule(overrides: Partial<ScheduleResponse> = {}): ScheduleResponse {
  return {
    id: SCHEDULE_ID,
    name: "Old name",
    category: "sightseeing",
    address: null,
    departurePlace: null,
    arrivalPlace: null,
    transportMethod: null,
    startTime: null,
    endTime: null,
    endDayOffset: null,
    memo: null,
    cost: null,
    urls: [],
    color: "blue",
    latitude: null,
    longitude: null,
    placeId: null,
    sortOrder: 0,
    crossDayAnchor: null,
    crossDayAnchorSourceId: null,
    updatedAt: "2026-06-13T00:00:00.000Z",
    ...overrides,
  };
}

function makePattern(schedules: ScheduleResponse[]): DayPatternResponse {
  return { id: PATTERN_ID, label: "Default", isDefault: true, sortOrder: 0, schedules };
}

function makeDay(schedules: ScheduleResponse[]): DayResponse {
  return { id: DAY_ID, dayNumber: 1, date: "2026-06-13", patterns: [makePattern(schedules)] };
}

function seedTrip(schedule: ScheduleResponse): TripResponse {
  return {
    id: TRIP_ID,
    title: "Test Trip",
    destination: "Tokyo",
    startDate: "2026-06-13",
    endDate: "2026-06-15",
    status: "planned",
    coverImageUrl: null,
    coverImagePosition: 50,
    shareToken: null,
    currency: "JPY",
    role: "owner",
    days: [makeDay([schedule])],
    candidates: [],
    scheduleCount: 1,
    expenseCount: 0,
    memberCount: 1,
    poll: null,
    mapsEnabled: false,
  };
}

function renderDialog(schedule: ScheduleResponse) {
  const onSaved = vi.fn();
  const onConflict = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.trips.detail(TRIP_ID), seedTrip(schedule));
  render(
    <NextIntlClientProvider locale="ja" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <EditScheduleDialog
          tripId={TRIP_ID}
          dayId={DAY_ID}
          patternId={PATTERN_ID}
          schedule={schedule}
          open
          onOpenChange={vi.fn()}
          onSaved={onSaved}
          onConflict={onConflict}
        />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { onSaved, onConflict, queryClient };
}

function submit() {
  // Clicking the type="submit" button fires the form's onSubmit handler.
  fireEvent.click(screen.getByRole("button", { name: messages.schedule.updateSchedule }));
}

function readSchedule(queryClient: QueryClient): ScheduleResponse {
  const trip = queryClient.getQueryData<TripResponse>(queryKeys.trips.detail(TRIP_ID));
  if (!trip) throw new Error("trip cache missing");
  return trip.days[0].patterns[0].schedules[0];
}

describe("EditScheduleDialog stale-refetch fix (#155)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it("reconciles cache with the server row and calls onSaved (not onConflict) on success", async () => {
    const schedule = makeSchedule();
    mockApi.mockResolvedValue({
      ...schedule,
      name: "Server name",
      updatedAt: "2026-06-13T01:00:00.000Z",
    });
    const { onSaved, onConflict, queryClient } = renderDialog(schedule);

    submit();

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onConflict).not.toHaveBeenCalled();
    expect(mockApi).toHaveBeenCalledTimes(1);
    // Cache now holds the server-confirmed row (fresh name + updatedAt).
    const cached = readSchedule(queryClient);
    expect(cached.name).toBe("Server name");
    expect(cached.updatedAt).toBe("2026-06-13T01:00:00.000Z");
  });

  it("falls back to onConflict and rolls back the cache on a 409 conflict", async () => {
    const schedule = makeSchedule();
    mockApi.mockRejectedValue(new ApiError("conflict", 409));
    const { onSaved, onConflict, queryClient } = renderDialog(schedule);

    submit();

    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
    // Optimistic write was rolled back to the original row.
    expect(readSchedule(queryClient).name).toBe("Old name");
  });

  it("falls back to onConflict when the cache was evicted during the round-trip", async () => {
    const schedule = makeSchedule();
    const { onSaved, onConflict, queryClient } = renderDialog(schedule);
    mockApi.mockImplementation(async () => {
      // Simulate the trip cache being evicted before the response resolves.
      queryClient.removeQueries({ queryKey: queryKeys.trips.detail(TRIP_ID) });
      return { ...schedule, name: "Server name" };
    });

    submit();

    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
