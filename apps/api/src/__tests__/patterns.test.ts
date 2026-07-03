import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, TEST_USER } from "./test-helpers";

const {
  mockGetSession,
  mockDbQuery,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockDbSelect,
  mockTxSelect,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbQuery: {
    tripDays: {
      findFirst: vi.fn(),
    },
    dayPatterns: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    tripMembers: {
      findFirst: vi.fn(),
    },
  },
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbDelete: vi.fn(),
  mockDbSelect: vi.fn(),
  // Records selects issued on the transaction handle (still delegates to
  // mockDbSelect) so tests can assert a query runs INSIDE the transaction.
  mockTxSelect: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("../db/index", () => {
  const tx = {
    query: mockDbQuery,
    execute: async () => undefined,
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    select: (...args: unknown[]) => {
      mockTxSelect(...args);
      return mockDbSelect(...args);
    },
  };
  return {
    db: {
      ...tx,
      select: (...args: unknown[]) => mockDbSelect(...args),
      transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

vi.mock("../lib/activity-logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import { MAX_PATTERNS_PER_DAY, MAX_SCHEDULES_PER_TRIP } from "@sugara/shared";
import { patternRoutes } from "../routes/patterns";

const fakeUser = TEST_USER;
const tripId = "trip-1";
const dayId = "day-1";
const patternId = "pattern-1";
const basePath = `/api/trips/${tripId}/days/${dayId}/patterns`;

describe("Pattern routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
    mockDbQuery.tripDays.findFirst.mockResolvedValue({
      id: dayId,
      tripId,
    });
    mockDbQuery.tripMembers.findFirst.mockResolvedValue({
      tripId,
      userId: fakeUser.id,
      role: "owner",
    });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ max: 0 }]),
      }),
    });
  });

  describe(`GET ${basePath}`, () => {
    it("returns patterns for a day", async () => {
      const patterns = [
        { id: "p-1", label: "デフォルト", isDefault: true, sortOrder: 0, schedules: [] },
      ];
      mockDbQuery.dayPatterns.findMany.mockResolvedValue(patterns);

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(basePath);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(patterns);
    });

    it("returns 404 when day does not belong to trip", async () => {
      mockDbQuery.tripDays.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(basePath);

      expect(res.status).toBe(404);
    });

    it("returns 404 for non-member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(null);

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(basePath);

      expect(res.status).toBe(404);
    });
  });

  describe(`POST ${basePath}`, () => {
    it("creates a pattern with valid label", async () => {
      const created = {
        id: "p-2",
        tripDayId: dayId,
        label: "Rainy",
        isDefault: false,
        sortOrder: 1,
      };
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Rainy" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.label).toBe("Rainy");
    });

    it("returns 400 for empty label", async () => {
      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when viewer tries to create", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId,
        userId: fakeUser.id,
        role: "viewer",
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Rainy" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when pattern limit reached", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_PATTERNS_PER_DAY }]),
        }),
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Rainy" }),
      });

      expect(res.status).toBe(409);
    });

    // The cap count must run inside the transaction (behind the advisory
    // lock), or two concurrent creates can both pass the cap and exceed it.
    it("checks the pattern limit inside the transaction", async () => {
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue([
              { id: "p-2", tripDayId: dayId, label: "Rainy", isDefault: false, sortOrder: 1 },
            ]),
        }),
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "Rainy" }),
      });

      // pattern count + sortOrder max — both on the tx handle
      expect(mockTxSelect).toHaveBeenCalledTimes(2);
    });
  });

  describe(`PATCH ${basePath}/${patternId}`, () => {
    it("updates pattern label", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDayId: dayId,
        label: "Old",
        isDefault: false,
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ id: patternId, label: "New", isDefault: false }]),
          }),
        }),
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "New" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.label).toBe("New");
    });

    it("returns 404 for non-existent pattern", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "New" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid data", async () => {
      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: "" }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe(`DELETE ${basePath}/${patternId}`, () => {
    it("deletes a non-default pattern", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDayId: dayId,
        isDefault: false,
      });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
    });

    it("returns 400 when deleting default pattern", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDayId: dayId,
        isDefault: true,
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent pattern", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  describe(`POST ${basePath}/${patternId}/duplicate`, () => {
    it("duplicates a pattern with schedules", async () => {
      const sourceSchedules = [
        {
          name: "Tokyo Tower",
          category: "sightseeing",
          address: null,
          startTime: "09:00",
          endTime: "10:00",
          sortOrder: 0,
          memo: null,
          url: null,
          departurePlace: null,
          arrivalPlace: null,
          transportMethod: null,
          color: null,
        },
      ];
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDayId: dayId,
        label: "Sunny",
        schedules: sourceSchedules,
      });

      const duplicated = {
        id: "p-new",
        tripDayId: dayId,
        label: "Sunny (copy)",
        isDefault: false,
        sortOrder: 1,
      };
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([duplicated]),
        }),
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}/duplicate`, {
        method: "POST",
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.label).toBe("Sunny (copy)");
    });

    it("returns 404 for non-existent pattern", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}/duplicate`, {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when pattern limit reached", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDayId: dayId,
        label: "Sunny",
        schedules: [],
      });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_PATTERNS_PER_DAY }]),
        }),
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}/duplicate`, {
        method: "POST",
      });

      expect(res.status).toBe(409);
    });

    it("returns 409 when duplicating would exceed the per-trip schedule limit", async () => {
      // Source pattern carries enough schedules that cloning them would push the
      // trip over MAX_SCHEDULES_PER_TRIP, even though the per-day pattern count
      // is still under MAX_PATTERNS_PER_DAY.
      const sourceSchedules = Array.from({ length: 5 }, (_, i) => ({
        name: `Spot ${i}`,
        category: "sightseeing",
        address: null,
        startTime: null,
        endTime: null,
        sortOrder: i,
        memo: null,
        urls: null,
        departurePlace: null,
        arrivalPlace: null,
        transportMethod: null,
        color: null,
        endDayOffset: 0,
      }));
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDayId: dayId,
        label: "Sunny",
        schedules: sourceSchedules,
      });
      // Pattern-count select returns under the per-day cap; schedule-count select
      // (via getScheduleCount) returns MAX_SCHEDULES_PER_TRIP - 3, so + 5 clones
      // exceeds the per-trip cap.
      mockDbSelect
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 1 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: MAX_SCHEDULES_PER_TRIP - 3 }]),
          }),
        });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}/duplicate`, {
        method: "POST",
      });

      expect(res.status).toBe(409);
    });

    it("checks the duplicate limits inside the transaction", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDayId: dayId,
        label: "Sunny",
        schedules: [],
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: "p-new",
              tripDayId: dayId,
              label: "Sunny (copy)",
              isDefault: false,
              sortOrder: 1,
            },
          ]),
        }),
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      await app.request(`${basePath}/${patternId}/duplicate`, {
        method: "POST",
      });

      // pattern count + trip schedule count + sortOrder max — all on the tx handle
      expect(mockTxSelect).toHaveBeenCalledTimes(3);
    });
  });

  describe(`POST ${basePath}/${patternId}/overwrite`, () => {
    const sourceId = "00000000-0000-0000-0000-000000000001";

    it("overwrites target pattern schedules with source schedules", async () => {
      const sourceSchedules = [
        {
          id: "s-1",
          name: "Tokyo Tower",
          category: "sightseeing",
          address: null,
          startTime: "09:00",
          endTime: "10:00",
          sortOrder: 0,
          memo: null,
          urls: null,
          departurePlace: null,
          arrivalPlace: null,
          transportMethod: null,
          color: null,
          endDayOffset: 0,
        },
      ];
      // First findFirst: verify target pattern
      mockDbQuery.dayPatterns.findFirst.mockResolvedValueOnce({
        id: patternId,
        tripDayId: dayId,
        label: "Target",
      });
      // Second findFirst: get source pattern with schedules
      mockDbQuery.dayPatterns.findFirst.mockResolvedValueOnce({
        id: sourceId,
        tripDayId: dayId,
        label: "Source",
        schedules: sourceSchedules,
      });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}/overwrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePatternId: sourceId }),
      });

      expect(res.status).toBe(200);
      expect(mockDbDelete).toHaveBeenCalled();
      expect(mockDbInsert).toHaveBeenCalled();
    });

    it("returns 404 when target pattern does not exist", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValueOnce(undefined);

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}/overwrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePatternId: sourceId }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when source pattern does not exist", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValueOnce({
        id: patternId,
        tripDayId: dayId,
        label: "Target",
      });
      mockDbQuery.dayPatterns.findFirst.mockResolvedValueOnce(undefined);

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}/overwrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePatternId: sourceId }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 for invalid body", async () => {
      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}/overwrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePatternId: "not-a-uuid" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 409 when overwrite would exceed schedule limit", async () => {
      const sourceSchedules = Array.from({ length: 10 }, (_, i) => ({
        id: `s-${i}`,
        name: `Spot ${i}`,
        category: "sightseeing",
        address: null,
        startTime: null,
        endTime: null,
        sortOrder: i,
        memo: null,
        urls: null,
        departurePlace: null,
        arrivalPlace: null,
        transportMethod: null,
        color: null,
        endDayOffset: 0,
      }));

      mockDbQuery.dayPatterns.findFirst.mockResolvedValueOnce({
        id: patternId,
        tripDayId: dayId,
        label: "Target",
      });
      mockDbQuery.dayPatterns.findFirst.mockResolvedValueOnce({
        id: "00000000-0000-0000-0000-000000000001",
        tripDayId: dayId,
        label: "Source",
        schedules: sourceSchedules,
      });

      // First select: getScheduleCount returns total = MAX - 1
      // Second select: target pattern has 2 schedules
      // After overwrite: (MAX - 1) - 2 + 10 = MAX + 7 > MAX
      mockDbSelect
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: MAX_SCHEDULES_PER_TRIP - 1 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 2 }]),
          }),
        });

      const app = createTestApp(patternRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${patternId}/overwrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePatternId: "00000000-0000-0000-0000-000000000001" }),
      });

      expect(res.status).toBe(409);
    });
  });
});
