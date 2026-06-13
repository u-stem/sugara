import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, TEST_USER } from "./test-helpers";

const {
  mockGetSession,
  mockDbQuery,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockDbSelect,
  mockCreateNotification,
  mockNotifyTripMembersExcluding,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbQuery: {
    schedules: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    trips: {
      findFirst: vi.fn(),
    },
    tripDays: {
      findFirst: vi.fn(),
    },
    dayPatterns: {
      findFirst: vi.fn(),
    },
    tripMembers: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbDelete: vi.fn(),
  mockDbSelect: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockNotifyTripMembersExcluding: vi.fn(),
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
    select: (...args: unknown[]) => mockDbSelect(...args),
  };
  return {
    db: { ...tx, transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});

vi.mock("../lib/activity-logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notifications", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
  notifyTripMembersExcluding: (...args: unknown[]) => mockNotifyTripMembersExcluding(...args),
}));

import { MAX_SCHEDULES_PER_TRIP } from "@sugara/shared";
import { logActivity } from "../lib/activity-logger";
import { scheduleRoutes } from "../routes/schedules";

const fakeUser = TEST_USER;
const tripId = "trip-1";
const dayId = "day-1";
const patternId = "pattern-1";
const basePath = `/api/trips/${tripId}/days/${dayId}/patterns/${patternId}/schedules`;

describe("Schedule routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
    // Default: day belongs to trip, pattern belongs to day, user is an editor/owner
    mockDbQuery.tripDays.findFirst.mockResolvedValue({
      id: dayId,
      tripId,
    });
    mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
      id: patternId,
      tripDayId: dayId,
      tripDay: { id: dayId, tripId },
    });
    mockDbQuery.tripMembers.findFirst.mockResolvedValue({
      tripId,
      userId: fakeUser.id,
      role: "owner",
    });
    mockDbQuery.tripMembers.findMany.mockResolvedValue([]);
    mockDbQuery.trips.findFirst.mockResolvedValue({ title: "テスト旅行" });
    mockCreateNotification.mockResolvedValue(undefined);
    mockNotifyTripMembersExcluding.mockReturnValue(undefined);
  });

  describe(`GET ${basePath}`, () => {
    it("returns schedules for a pattern", async () => {
      const patternSchedules = [
        { id: "schedule-1", name: "Tokyo Tower", category: "sightseeing", sortOrder: 0 },
      ];
      mockDbQuery.schedules.findMany.mockResolvedValue(patternSchedules);

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual(patternSchedules);
    });

    it("returns 404 when day does not belong to trip", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDayId: dayId,
        tripDay: { id: dayId, tripId: "other-trip" },
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath);

      expect(res.status).toBe(404);
    });

    it("returns 404 when pattern does not belong to day", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath);

      expect(res.status).toBe(404);
    });
  });

  describe(`POST ${basePath}`, () => {
    it("returns 201 with valid data", async () => {
      const createdSchedule = {
        id: "schedule-1",
        dayPatternId: patternId,
        name: "Tokyo Tower",
        category: "sightseeing",
        sortOrder: 0,
      };

      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: -1 }]),
        }),
      });

      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([createdSchedule]),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tokyo Tower",
          category: "sightseeing",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("Tokyo Tower");
    });

    it("returns 400 with empty name", async () => {
      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "",
          category: "sightseeing",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 with invalid category", async () => {
      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tokyo Tower",
          category: "invalid_category",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 201 with transport-specific fields", async () => {
      const createdSchedule = {
        id: "schedule-2",
        dayPatternId: patternId,
        name: "Tokyo to Osaka",
        category: "transport",
        departurePlace: "Tokyo Station",
        arrivalPlace: "Shin-Osaka Station",
        transportMethod: "train",
        sortOrder: 0,
      };

      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: -1 }]),
        }),
      });

      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([createdSchedule]),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tokyo to Osaka",
          category: "transport",
          departurePlace: "Tokyo Station",
          arrivalPlace: "Shin-Osaka Station",
          transportMethod: "train",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.departurePlace).toBe("Tokyo Station");
      expect(body.arrivalPlace).toBe("Shin-Osaka Station");
      expect(body.transportMethod).toBe("train");
    });

    it("returns 400 with invalid transportMethod", async () => {
      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tokyo to Osaka",
          category: "transport",
          transportMethod: "helicopter",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when day does not belong to trip", async () => {
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDayId: dayId,
        tripDay: { id: dayId, tripId: "other-trip" },
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tokyo Tower",
          category: "sightseeing",
        }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when schedule limit reached", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_SCHEDULES_PER_TRIP }]),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tokyo Tower",
          category: "sightseeing",
        }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe(`PATCH ${basePath}/:scheduleId`, () => {
    it("returns updated schedule on success", async () => {
      const existing = { id: "schedule-1", name: "Old Name", category: "sightseeing" };
      const updated = { ...existing, name: "New Name" };
      mockDbQuery.schedules.findFirst.mockResolvedValue(existing);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/schedule-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.name).toBe("New Name");
    });

    it("returns 400 with invalid data", async () => {
      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/schedule-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "invalid_category" }),
      });

      expect(res.status).toBe(400);
    });

    it("updates transport-specific fields", async () => {
      const existing = {
        id: "schedule-1",
        name: "Move",
        category: "transport",
        departurePlace: "Tokyo",
        transportMethod: "bus",
      };
      const updated = {
        ...existing,
        departurePlace: "Shinjuku",
        transportMethod: "train",
      };
      mockDbQuery.schedules.findFirst.mockResolvedValue(existing);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/schedule-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departurePlace: "Shinjuku",
          transportMethod: "train",
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.departurePlace).toBe("Shinjuku");
      expect(body.transportMethod).toBe("train");
    });

    it("returns 404 when schedule not found", async () => {
      mockDbQuery.schedules.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/schedule-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when expectedUpdatedAt does not match", async () => {
      const existing = { id: "schedule-1", name: "Old", category: "sightseeing" };
      mockDbQuery.schedules.findFirst.mockResolvedValue(existing);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/schedule-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stale Update",
          expectedUpdatedAt: "2024-01-01T00:00:00.000Z",
        }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe(`DELETE ${basePath}/:scheduleId`, () => {
    it("returns ok on success", async () => {
      mockDbQuery.schedules.findFirst.mockResolvedValue({ id: "schedule-1" });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/schedule-1`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true });
    });

    it("returns 404 when schedule not found", async () => {
      mockDbQuery.schedules.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/nonexistent`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/trips/:tripId/schedules/batch-unassign", () => {
    const id1 = "00000000-0000-0000-0000-000000000001";
    const id2 = "00000000-0000-0000-0000-000000000002";

    it("unassigns multiple schedules to candidates", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([
        { id: id1, tripId, dayPatternId: patternId, dayPattern: { tripDay: { id: dayId } } },
        { id: id2, tripId, dayPatternId: patternId, dayPattern: { tripDay: { id: dayId } } },
      ]);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: 0 }]),
        }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/schedules/batch-unassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 400 for empty scheduleIds", async () => {
      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/schedules/batch-unassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when some schedules are not assigned", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([
        { id: id1, tripId, dayPatternId: patternId },
      ]);

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/schedules/batch-unassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe(`POST ${basePath}/batch-delete`, () => {
    const id1 = "00000000-0000-0000-0000-000000000001";
    const id2 = "00000000-0000-0000-0000-000000000002";

    it("deletes multiple schedules from a pattern", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([
        { id: id1, dayPatternId: patternId },
        { id: id2, dayPatternId: patternId },
      ]);
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 400 for empty scheduleIds", async () => {
      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when some schedules do not belong to pattern", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([{ id: id1, dayPatternId: patternId }]);

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe(`POST ${basePath}/batch-duplicate`, () => {
    const id1 = "00000000-0000-0000-0000-000000000001";
    const id2 = "00000000-0000-0000-0000-000000000002";

    it("duplicates multiple schedules and returns 201", async () => {
      const existingSchedules = [
        {
          id: id1,
          tripId,
          dayPatternId: patternId,
          name: "Spot A",
          category: "restaurant",
          memo: "good food",
          address: null,
          startTime: "10:00",
          endTime: "11:00",
          urls: [],
          departurePlace: null,
          arrivalPlace: null,
          transportMethod: null,
          color: "blue",
          sortOrder: 0,
        },
        {
          id: id2,
          tripId,
          dayPatternId: patternId,
          name: "Spot B",
          category: "sightseeing",
          memo: null,
          address: "Tokyo",
          startTime: null,
          endTime: null,
          urls: ["https://example.com"],
          departurePlace: null,
          arrivalPlace: null,
          transportMethod: null,
          color: "red",
          sortOrder: 1,
        },
      ];
      mockDbQuery.schedules.findMany.mockResolvedValue(existingSchedules);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: 1 }]),
        }),
      });
      const duplicated = [
        { ...existingSchedules[0], id: "new-1", sortOrder: 2 },
        { ...existingSchedules[1], id: "new-2", sortOrder: 3 },
      ];
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(duplicated),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toHaveLength(2);
    });

    it("returns 400 for empty scheduleIds", async () => {
      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when some schedules do not belong to pattern", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([{ id: id1, dayPatternId: patternId }]);

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when schedule limit would be exceeded", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_SCHEDULES_PER_TRIP - 1 }]),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe(`PATCH ${basePath}/reorder`, () => {
    it("returns ok with valid UUIDs", async () => {
      const scheduleId = "550e8400-e29b-41d4-a716-446655440000";
      mockDbQuery.schedules.findMany.mockResolvedValue([
        { id: scheduleId, dayPatternId: patternId },
      ]);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduleIds: [scheduleId],
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true });
      expect(logActivity).not.toHaveBeenCalled();
    });

    it("returns 400 with invalid data", async () => {
      const app = createTestApp(scheduleRoutes, "/api/trips");
      const res = await app.request(`${basePath}/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: ["not-a-uuid"] }),
      });

      expect(res.status).toBe(400);
    });
  });
});
