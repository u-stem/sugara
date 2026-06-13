import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockDbQuery, mockDbInsert, mockDbUpdate, mockDbDelete, mockDbSelect } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockDbQuery: {
      schedules: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      tripMembers: {
        findFirst: vi.fn(),
      },
      dayPatterns: {
        findFirst: vi.fn(),
      },
      bookmarks: {
        findMany: vi.fn(),
      },
    },
    mockDbInsert: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockDbDelete: vi.fn(),
    mockDbSelect: vi.fn(),
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
  notifyTripMembersExcluding: vi.fn(),
}));

import { MAX_SCHEDULES_PER_TRIP } from "@sugara/shared";
import { candidateRoutes } from "../routes/candidates";
import { createTestApp, TEST_USER } from "./test-helpers";

const fakeUser = TEST_USER;
const tripId = "trip-1";

describe("Candidate routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
    mockDbQuery.tripMembers.findFirst.mockResolvedValue({
      tripId,
      userId: fakeUser.id,
      role: "owner",
    });
  });

  describe("GET /api/trips/:tripId/candidates", () => {
    it("returns candidates sorted by sortOrder", async () => {
      const candidates = [
        {
          id: "s1",
          name: "Spot A",
          category: "restaurant",
          sortOrder: 0,
          likeCount: 0,
          hmmCount: 0,
          myReaction: null,
        },
        {
          id: "s2",
          name: "Spot B",
          category: "sightseeing",
          sortOrder: 1,
          likeCount: 0,
          hmmCount: 0,
          myReaction: null,
        },
      ];
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(candidates),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].name).toBe("Spot A");
    });

    it("returns 404 when user is not a trip member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates`);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/trips/:tripId/candidates", () => {
    it("creates candidate and returns 201", async () => {
      const created = {
        id: "s1",
        tripId,
        name: "New Spot",
        category: "restaurant",
        memo: null,
        sortOrder: 0,
      };

      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: -1 }]),
        }),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Spot", category: "restaurant" }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.name).toBe("New Spot");
    });

    it("creates candidate with urls", async () => {
      const created = {
        id: "s1",
        tripId,
        name: "Cafe",
        category: "restaurant",
        memo: null,
        urls: ["https://example.com"],
        sortOrder: 0,
      };

      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: -1 }]),
        }),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Cafe",
          category: "restaurant",
          urls: ["https://example.com"],
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.urls).toEqual(["https://example.com"]);
    });

    it("creates candidate with all schedule fields", async () => {
      const created = {
        id: "s1",
        tripId,
        name: "Tokyo to Osaka",
        category: "transport",
        address: "Tokyo Station",
        startTime: "08:00",
        endTime: "10:30",
        memo: "Nozomi express",
        urls: ["https://example.com"],
        departurePlace: "Tokyo Station",
        arrivalPlace: "Shin-Osaka Station",
        transportMethod: "shinkansen",
        color: "red",
        endDayOffset: 1,
        sortOrder: 0,
      };

      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: -1 }]),
        }),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([created]),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Tokyo to Osaka",
          category: "transport",
          address: "Tokyo Station",
          startTime: "08:00",
          endTime: "10:30",
          memo: "Nozomi express",
          urls: ["https://example.com"],
          departurePlace: "Tokyo Station",
          arrivalPlace: "Shin-Osaka Station",
          transportMethod: "shinkansen",
          color: "red",
          endDayOffset: 1,
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.name).toBe("Tokyo to Osaka");
    });

    it("returns 400 for empty name", async () => {
      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", category: "restaurant" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid category", async () => {
      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Spot", category: "invalid" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 for viewer role", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId,
        userId: fakeUser.id,
        role: "viewer",
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Spot", category: "restaurant" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when schedule limit reached", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_SCHEDULES_PER_TRIP }]),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Spot", category: "restaurant" }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe("PATCH /api/trips/:tripId/candidates/:scheduleId", () => {
    it("updates candidate fields", async () => {
      const existing = { id: "s1", tripId, name: "Old", dayPatternId: null };
      const updated = { ...existing, name: "Updated" };

      mockDbQuery.schedules.findFirst.mockResolvedValue(existing);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/s1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.name).toBe("Updated");
    });

    it("returns 404 for non-existent candidate", async () => {
      mockDbQuery.schedules.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/s1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when expectedUpdatedAt does not match", async () => {
      const existing = { id: "s1", tripId, name: "Old", dayPatternId: null };
      mockDbQuery.schedules.findFirst.mockResolvedValue(existing);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/s1`, {
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

  describe("DELETE /api/trips/:tripId/candidates/:scheduleId", () => {
    it("deletes candidate", async () => {
      mockDbQuery.schedules.findFirst.mockResolvedValue({ id: "s1", tripId, dayPatternId: null });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/s1`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 404 for non-existent candidate", async () => {
      mockDbQuery.schedules.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/s1`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/trips/:tripId/candidates/reorder", () => {
    it("reorders candidates", async () => {
      const id1 = "00000000-0000-0000-0000-000000000001";
      const id2 = "00000000-0000-0000-0000-000000000002";
      mockDbQuery.schedules.findMany.mockResolvedValue([
        { id: id1, tripId, dayPatternId: null },
        { id: id2, tripId, dayPatternId: null },
      ]);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id2, id1] }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 400 for invalid UUIDs", async () => {
      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/reorder`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: ["not-a-uuid"] }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/trips/:tripId/candidates/batch-assign", () => {
    const patternId = "00000000-0000-0000-0000-000000000010";
    const dayId = "day-1";
    const id1 = "00000000-0000-0000-0000-000000000001";
    const id2 = "00000000-0000-0000-0000-000000000002";

    it("assigns multiple candidates to a pattern", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([
        { id: id1, tripId, dayPatternId: null },
        { id: id2, tripId, dayPatternId: null },
      ]);
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDay: { id: dayId, tripId },
      });
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

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2], dayPatternId: patternId }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 400 for empty scheduleIds", async () => {
      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [], dayPatternId: patternId }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when some schedules are not candidates", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([{ id: id1, tripId, dayPatternId: null }]);
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDay: { id: dayId, tripId },
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2], dayPatternId: patternId }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when pattern does not belong to trip", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([{ id: id1, tripId, dayPatternId: null }]);
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1], dayPatternId: patternId }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/trips/:tripId/candidates/batch-delete", () => {
    const id1 = "00000000-0000-0000-0000-000000000001";
    const id2 = "00000000-0000-0000-0000-000000000002";

    it("deletes multiple candidates", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([
        { id: id1, tripId, dayPatternId: null },
        { id: id2, tripId, dayPatternId: null },
      ]);
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 400 for empty scheduleIds", async () => {
      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when some schedules are not candidates", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([{ id: id1, tripId, dayPatternId: null }]);

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/trips/:tripId/candidates/batch-duplicate", () => {
    const id1 = "00000000-0000-0000-0000-000000000001";
    const id2 = "00000000-0000-0000-0000-000000000002";

    it("duplicates multiple candidates and returns 201", async () => {
      const existingSchedules = [
        {
          id: id1,
          tripId,
          dayPatternId: null,
          name: "Spot A",
          category: "restaurant",
          memo: "good food",
          address: null,
          startTime: null,
          endTime: null,
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
          dayPatternId: null,
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

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toHaveLength(2);
    });

    it("returns 400 for empty scheduleIds", async () => {
      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when some schedules are not candidates", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([{ id: id1, tripId, dayPatternId: null }]);

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-duplicate`, {
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

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleIds: [id1, id2] }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/trips/:tripId/candidates/from-bookmarks", () => {
    const bm1 = "00000000-0000-0000-0000-000000000031";
    const bm2 = "00000000-0000-0000-0000-000000000032";

    it("creates candidates from bookmarks with 201", async () => {
      mockDbQuery.bookmarks.findMany.mockResolvedValue([
        {
          id: bm1,
          name: "Cafe A",
          memo: "good",
          urls: ["https://a.com"],
          listId: "list-1",
          list: { userId: fakeUser.id },
        },
        {
          id: bm2,
          name: "Cafe B",
          memo: null,
          urls: [],
          listId: "list-1",
          list: { userId: fakeUser.id },
        },
      ]);
      mockDbSelect
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ max: -1 }]),
          }),
        });
      const created = [
        { id: "new-1", name: "Cafe A", tripId, sortOrder: 0 },
        { id: "new-2", name: "Cafe B", tripId, sortOrder: 1 },
      ];
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(created),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/from-bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1, bm2] }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body).toHaveLength(2);
    });

    it("returns 400 with empty bookmarkIds", async () => {
      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/from-bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when bookmarks not found", async () => {
      mockDbQuery.bookmarks.findMany.mockResolvedValue([]);

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/from-bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1] }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when schedule limit exceeded", async () => {
      mockDbQuery.bookmarks.findMany.mockResolvedValue([
        {
          id: bm1,
          name: "Cafe A",
          memo: null,
          urls: [],
          listId: "list-1",
          list: { userId: fakeUser.id },
        },
      ]);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_SCHEDULES_PER_TRIP }]),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/from-bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1] }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe("POST /api/trips/:tripId/candidates/:scheduleId/assign", () => {
    it("assigns candidate to a pattern", async () => {
      const patternId = "00000000-0000-0000-0000-000000000010";
      const dayId = "day-1";
      const scheduleId = "s1";
      const existing = { id: scheduleId, tripId, dayPatternId: null };
      const updated = { ...existing, dayPatternId: patternId, sortOrder: 0 };

      mockDbQuery.schedules.findFirst.mockResolvedValue(existing);
      mockDbQuery.dayPatterns.findFirst.mockResolvedValue({
        id: patternId,
        tripDay: { id: dayId, tripId },
      });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: -1 }]),
        }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/${scheduleId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayPatternId: patternId }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.dayPatternId).toBe(patternId);
    });

    it("returns 400 for missing dayPatternId", async () => {
      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/s1/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when schedule is not a candidate", async () => {
      mockDbQuery.schedules.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(candidateRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/candidates/s1/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dayPatternId: "00000000-0000-0000-0000-000000000001" }),
      });

      expect(res.status).toBe(404);
    });
  });
});
