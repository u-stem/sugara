import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, TEST_USER } from "./test-helpers";

const {
  mockGetSession,
  mockDbQuery,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockDbSelect,
  mockGetAppSettings,
  mockGetAdminUserId,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetAppSettings: vi.fn(),
  mockGetAdminUserId: vi.fn(),
  mockDbQuery: {
    trips: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    tripMembers: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    schedules: {
      findMany: vi.fn(),
    },
    schedulePolls: {
      findFirst: vi.fn(),
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
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
  };
  return {
    db: { ...tx, transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});

vi.mock("../lib/activity-logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/app-settings", () => ({
  getAppSettings: (...args: unknown[]) => mockGetAppSettings(...args),
}));

vi.mock("../lib/resolve-is-admin", () => ({
  getAdminUserId: (...args: unknown[]) => mockGetAdminUserId(...args),
}));

const mockValidateCoverImage = vi.fn();
const mockUploadCoverImage = vi.fn();
const mockDeleteCoverImage = vi.fn();
const mockCopyCoverImage = vi.fn();

vi.mock("../lib/storage", () => ({
  validateCoverImage: (...args: unknown[]) => mockValidateCoverImage(...args),
  uploadCoverImage: (...args: unknown[]) => mockUploadCoverImage(...args),
  deleteCoverImage: (...args: unknown[]) => mockDeleteCoverImage(...args),
  copyCoverImage: (...args: unknown[]) => mockCopyCoverImage(...args),
}));

import { tripRoutes } from "../routes/trips";

const fakeUser = TEST_USER;

describe("Trip routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
    // Default: user is the owner of the trip
    mockDbQuery.tripMembers.findFirst.mockResolvedValue({
      tripId: "trip-1",
      userId: fakeUser.id,
      role: "owner",
    });
    mockDbQuery.schedules.findMany.mockResolvedValue([]);
    mockDbQuery.schedulePolls.findFirst.mockResolvedValue(undefined);
    mockGetAppSettings.mockResolvedValue({
      signupEnabled: true,
      mapsMode: "admin_only",
    });
    mockGetAdminUserId.mockResolvedValue(null);
    // Default: select queries (trip count, trip list, member count, candidate query)
    const mockWhere = vi.fn().mockImplementation(() => {
      const result = Promise.resolve([{ count: 0 }]);
      (result as unknown as Record<string, unknown>).groupBy = vi.fn().mockResolvedValue([]);
      return result;
    });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
        innerJoin: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      }),
    });
  });

  describe("POST /api/trips", () => {
    it("returns 201 with valid data", async () => {
      const createdTrip = {
        id: "trip-1",
        ownerId: fakeUser.id,
        title: "Tokyo Trip",
        destination: "Tokyo",
        startDate: "2025-07-01",
        endDate: "2025-07-03",
        status: "draft",
      };

      // Sequential inserts: trips -> tripDays -> dayPatterns -> tripMembers
      mockDbInsert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([createdTrip]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ id: "day-1" }, { id: "day-2" }, { id: "day-3" }]),
          }),
        })
        .mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Tokyo Trip",
          destination: "Tokyo",
          startDate: "2025-07-01",
          endDate: "2025-07-03",
        }),
      });

      expect(res.status).toBe(201);
    });

    it("returns 400 with empty title", async () => {
      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "",
          destination: "Tokyo",
          startDate: "2025-07-01",
          endDate: "2025-07-03",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when endDate is before startDate", async () => {
      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Tokyo Trip",
          destination: "Tokyo",
          startDate: "2025-07-05",
          endDate: "2025-07-01",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Tokyo Trip",
          destination: "Tokyo",
          startDate: "2025-07-01",
          endDate: "2025-07-03",
        }),
      });

      expect(res.status).toBe(401);
    });

    it("returns 403 when guest user already has a trip", async () => {
      const guestUser = {
        ...fakeUser,
        isAnonymous: true,
        guestExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      mockGetSession.mockResolvedValue({
        user: guestUser,
        session: { id: "session-1" },
      });

      // Guest trip check: select -> from -> innerJoin -> limit returns existing trip
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "existing-trip" }]),
          }),
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Second Trip",
          destination: "Osaka",
          startDate: "2025-08-01",
          endDate: "2025-08-03",
        }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toEqual({ error: "Guest accounts can only create 1 trip" });
    });

    it("allows guest user to create first trip", async () => {
      const guestUser = {
        ...fakeUser,
        isAnonymous: true,
        guestExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      mockGetSession.mockResolvedValue({
        user: guestUser,
        session: { id: "session-1" },
      });

      const createdTrip = {
        id: "trip-1",
        ownerId: guestUser.id,
        title: "First Trip",
        destination: "Kyoto",
        startDate: "2025-08-01",
        endDate: "2025-08-03",
        status: "draft",
      };

      // Guest trip check: no existing trips
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      });

      mockDbInsert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([createdTrip]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ id: "day-1" }, { id: "day-2" }, { id: "day-3" }]),
          }),
        })
        .mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "First Trip",
          destination: "Kyoto",
          startDate: "2025-08-01",
          endDate: "2025-08-03",
        }),
      });

      expect(res.status).toBe(201);
    });

    it("returns 409 when trip limit reached", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 10 }]),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Tokyo Trip",
          destination: "Tokyo",
          startDate: "2025-07-01",
          endDate: "2025-07-03",
        }),
      });

      expect(res.status).toBe(409);
    });

    it("returns LIMIT_TRIPS code when trip limit reached", async () => {
      const { ERROR_CODE, MAX_TRIPS_PER_USER } = await import("@sugara/shared");
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_TRIPS_PER_USER }]),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Tokyo Trip",
          destination: "Tokyo",
          startDate: "2025-07-01",
          endDate: "2025-07-03",
        }),
      });
      const body = await res.json();

      expect(body.code).toBe(ERROR_CODE.LIMIT_TRIPS);
    });

    it("returns details.max equal to MAX_TRIPS_PER_USER when trip limit reached", async () => {
      const { MAX_TRIPS_PER_USER } = await import("@sugara/shared");
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_TRIPS_PER_USER }]),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Tokyo Trip",
          destination: "Tokyo",
          startDate: "2025-07-01",
          endDate: "2025-07-03",
        }),
      });
      const body = await res.json();

      expect(body.details.max).toBe(MAX_TRIPS_PER_USER);
    });

    it("returns details.max equal to override value when per-user trip limit reached", async () => {
      const overrideLimit = 50;
      // 1st select: trip count at the override limit
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: overrideLimit }]),
        }),
      });
      // 2nd select: resolveTripLimit returns the override value
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ tripLimit: overrideLimit }]),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Tokyo Trip",
          destination: "Tokyo",
          startDate: "2025-07-01",
          endDate: "2025-07-03",
        }),
      });
      const body = await res.json();

      expect(body.details.max).toBe(overrideLimit);
    });
  });

  describe("GET /api/trips", () => {
    it("returns trips with totalSchedules", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue([
                    {
                      id: "trip-1",
                      title: "Tokyo Trip",
                      role: "owner",
                      totalSchedules: 2,
                      updatedAt: new Date("2025-07-01"),
                    },
                  ]),
                }),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].totalSchedules).toBe(2);
    });

    it("returns all trips by default (no scope filter)", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue([
                    {
                      id: "trip-1",
                      title: "My Trip",
                      role: "owner",
                      updatedAt: new Date("2025-07-01"),
                    },
                    {
                      id: "trip-2",
                      title: "Shared Trip",
                      role: "editor",
                      updatedAt: new Date("2025-07-02"),
                    },
                  ]),
                }),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
    });

    it("returns only owned trips when scope=owned", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue([
                    {
                      id: "trip-1",
                      title: "My Trip",
                      role: "owner",
                      updatedAt: new Date("2025-07-01"),
                    },
                  ]),
                }),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips?scope=owned");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("trip-1");
    });

    it("returns only shared trips when scope=shared", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
          innerJoin: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                groupBy: vi.fn().mockReturnValue({
                  orderBy: vi.fn().mockResolvedValue([
                    {
                      id: "trip-2",
                      title: "Shared Trip",
                      role: "editor",
                      updatedAt: new Date("2025-07-02"),
                    },
                  ]),
                }),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips?scope=shared");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe("trip-2");
    });

    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips");

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/trips/:id", () => {
    it("returns trip detail with role when found", async () => {
      const tripDetail = {
        id: "trip-1",
        title: "Tokyo Trip",
        ownerId: fakeUser.id,
        days: [],
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(tripDetail);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.id).toBe("trip-1");
      expect(body.role).toBe("owner");
    });

    it("returns editor role for editor member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: fakeUser.id,
        role: "editor",
      });
      mockDbQuery.trips.findFirst.mockResolvedValue({
        id: "trip-1",
        title: "Tokyo Trip",
        days: [],
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.role).toBe("editor");
    });

    it("computes scheduleCount from days and candidates", async () => {
      const tripDetail = {
        id: "trip-1",
        title: "Tokyo Trip",
        ownerId: fakeUser.id,
        days: [
          {
            id: "day-1",
            dayNumber: 1,
            patterns: [
              {
                id: "pat-1",
                sortOrder: 0,
                schedules: [
                  { id: "s-1", sortOrder: 0 },
                  { id: "s-2", sortOrder: 1 },
                ],
              },
            ],
          },
          {
            id: "day-2",
            dayNumber: 2,
            patterns: [
              {
                id: "pat-2",
                sortOrder: 0,
                schedules: [{ id: "s-3", sortOrder: 0 }],
              },
            ],
          },
        ],
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(tripDetail);

      // 2 candidates returned by queryCandidatesWithReactions
      const mockCandidates = [
        { id: "c-1", sortOrder: 0 },
        { id: "c-2", sortOrder: 1 },
      ];
      const mockWhere = vi.fn().mockImplementation(() => {
        const result = Promise.resolve([{ count: 3 }]);
        (result as unknown as Record<string, unknown>).groupBy = vi
          .fn()
          .mockResolvedValue(mockCandidates);
        return result;
      });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: mockWhere,
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockResolvedValue(mockCandidates),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1");
      const body = await res.json();

      expect(res.status).toBe(200);
      // 3 assigned schedules + 2 candidates = 5
      expect(body.scheduleCount).toBe(5);
    });

    it("returns 404 when user is not a member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/nonexistent");

      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/trips/:id", () => {
    const defaultTrip = {
      id: "trip-1",
      ownerId: fakeUser.id,
      title: "Tokyo Trip",
      destination: "Tokyo",
      startDate: "2025-07-01",
      endDate: "2025-07-03",
      status: "draft",
    };

    it("returns updated trip on success", async () => {
      mockDbQuery.trips.findFirst.mockResolvedValue(defaultTrip);
      const updated = { ...defaultTrip, title: "New Title" };
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Title" }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.title).toBe("New Title");
    });

    it("skips update when no fields changed", async () => {
      mockDbQuery.trips.findFirst.mockResolvedValue(defaultTrip);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Tokyo Trip" }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.title).toBe("Tokyo Trip");
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("skips syncTripDays when dates are unchanged", async () => {
      mockDbQuery.trips.findFirst.mockResolvedValue(defaultTrip);
      const updated = { ...defaultTrip, title: "New Title" };
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "New Title",
          startDate: "2025-07-01",
          endDate: "2025-07-03",
        }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.title).toBe("New Title");
      // syncTripDays calls select+delete+insert; only trips.update should run
      expect(mockDbDelete).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it("returns 404 when user is not a member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/nonexistent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Title" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when user is viewer (cannot edit)", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: fakeUser.id,
        role: "viewer",
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Title" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 with invalid data", async () => {
      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns updated trip when changing status", async () => {
      mockDbQuery.trips.findFirst.mockResolvedValue(defaultTrip);
      const updated = {
        id: "trip-1",
        title: "Tokyo Trip",
        ownerId: fakeUser.id,
        status: "planned",
      };
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "planned" }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.status).toBe("planned");
    });

    it("returns 400 with invalid status", async () => {
      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "invalid" }),
      });

      expect(res.status).toBe(400);
    });

    it("uses transaction to adjust trip_days when changing dates", async () => {
      const existingTrip = {
        id: "trip-1",
        startDate: "2025-07-01",
        endDate: "2025-07-03",
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(existingTrip);

      const updated = {
        id: "trip-1",
        title: "Tokyo Trip",
        startDate: "2025-07-02",
        endDate: "2025-07-05",
      };
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "new-day-1" }]),
        }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { id: "day-2", date: "2025-07-02", dayNumber: 1 },
              { id: "day-3", date: "2025-07-03", dayNumber: 2 },
            ]),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: "2025-07-02", endDate: "2025-07-05" }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 400 when startDate is after endDate", async () => {
      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: "2025-07-10", endDate: "2025-07-01" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when reducing trip days", async () => {
      const existingTrip = {
        id: "trip-1",
        startDate: "2025-07-01",
        endDate: "2025-07-03",
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(existingTrip);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: "2025-07-01", endDate: "2025-07-02" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Cannot reduce the number of trip days");
    });

    it("returns 200 when increasing trip days", async () => {
      const existingTrip = {
        id: "trip-1",
        startDate: "2025-07-01",
        endDate: "2025-07-03",
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(existingTrip);

      const updated = {
        id: "trip-1",
        title: "Tokyo Trip",
        startDate: "2025-07-01",
        endDate: "2025-07-05",
      };
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "new-day-1" }]),
        }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { id: "day-1", date: "2025-07-01", dayNumber: 1 },
              { id: "day-2", date: "2025-07-02", dayNumber: 2 },
              { id: "day-3", date: "2025-07-03", dayNumber: 3 },
            ]),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: "2025-07-01", endDate: "2025-07-05" }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 200 when shifting dates with same day count", async () => {
      const existingTrip = {
        id: "trip-1",
        startDate: "2025-07-01",
        endDate: "2025-07-03",
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(existingTrip);

      const updated = {
        id: "trip-1",
        title: "Tokyo Trip",
        startDate: "2025-07-05",
        endDate: "2025-07-07",
      };
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "new-day-1" }]),
        }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { id: "day-5", date: "2025-07-05", dayNumber: 1 },
              { id: "day-6", date: "2025-07-06", dayNumber: 2 },
              { id: "day-7", date: "2025-07-07", dayNumber: 3 },
            ]),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: "2025-07-05", endDate: "2025-07-07" }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 400 when only startDate is sent and reduces days", async () => {
      const existingTrip = {
        id: "trip-1",
        startDate: "2025-07-01",
        endDate: "2025-07-03",
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(existingTrip);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: "2025-07-02" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Cannot reduce the number of trip days");
    });

    it("returns 400 when only endDate is sent and reduces days", async () => {
      const existingTrip = {
        id: "trip-1",
        startDate: "2025-07-01",
        endDate: "2025-07-05",
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(existingTrip);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDate: "2025-07-03" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Cannot reduce the number of trip days");
    });

    it("returns 200 when only startDate is sent (not reducing days)", async () => {
      const existingTrip = {
        id: "trip-1",
        startDate: "2025-07-01",
        endDate: "2025-07-03",
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(existingTrip);

      const updated = {
        id: "trip-1",
        startDate: "2025-06-30",
        endDate: "2025-07-03",
      };
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: "new-day-1" }]),
        }),
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updated]),
          }),
        }),
      });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { id: "day-0", date: "2025-06-30", dayNumber: 1 },
              { id: "day-1", date: "2025-07-01", dayNumber: 2 },
              { id: "day-2", date: "2025-07-02", dayNumber: 3 },
              { id: "day-3", date: "2025-07-03", dayNumber: 4 },
            ]),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: "2025-06-30" }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe("POST /api/trips/:id/duplicate", () => {
    it("returns 409 when trip limit reached", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 10 }]),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1/duplicate", {
        method: "POST",
      });

      expect(res.status).toBe(409);
    });

    it("copies poll data when duplicating a scheduling trip", async () => {
      const sourcePoll = {
        id: "poll-1",
        tripId: "trip-1",
        note: "test note",
        deadline: new Date("2026-03-01"),
        status: "open",
        shareToken: "abc123",
        shareTokenExpiresAt: null,
        confirmedOptionId: null,
        options: [
          {
            id: "opt-1",
            pollId: "poll-1",
            startDate: "2026-04-01",
            endDate: "2026-04-03",
            sortOrder: 0,
          },
          {
            id: "opt-2",
            pollId: "poll-1",
            startDate: "2026-04-10",
            endDate: "2026-04-12",
            sortOrder: 1,
          },
        ],
        participants: [
          { id: "part-1", pollId: "poll-1", userId: fakeUser.id },
          { id: "part-2", pollId: "poll-1", userId: "other-user" },
        ],
      };

      mockDbQuery.trips.findFirst.mockResolvedValue({
        id: "trip-1",
        ownerId: "other-user",
        title: "Scheduling Trip",
        destination: "Osaka",
        startDate: null,
        endDate: null,
        status: "scheduling",
        days: [],
      });

      mockDbQuery.schedulePolls.findFirst.mockResolvedValue(sourcePoll);

      const createdTrip = {
        id: "new-trip",
        ownerId: fakeUser.id,
        title: "Scheduling Trip (copy)",
        destination: "Osaka",
        startDate: null,
        endDate: null,
        status: "scheduling",
      };

      // Sequential inserts: trip -> poll -> options -> participants -> tripMembers
      mockDbInsert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([createdTrip]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: "new-poll" }]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValue(undefined),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValue(undefined),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1/duplicate", {
        method: "POST",
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.status).toBe("scheduling");
      expect(body.title).toBe("Scheduling Trip (copy)");
      // Verify poll data was queried and copied
      expect(mockDbQuery.schedulePolls.findFirst).toHaveBeenCalled();
    });
  });

  describe("DELETE /api/trips/:id", () => {
    it("returns ok on success", async () => {
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true });
    });

    it("returns 404 when user is not a member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/nonexistent", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when user is editor (not owner)", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: fakeUser.id,
        role: "editor",
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("deletes cover image from storage before deleting trip", async () => {
      mockDbQuery.trips.findFirst.mockResolvedValue({
        coverImageUrl: "http://localhost:54321/storage/v1/object/public/trip-covers/trip-1/img.jpg",
      });
      mockDeleteCoverImage.mockResolvedValue(undefined);
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1", { method: "DELETE" });

      expect(res.status).toBe(200);
      expect(mockDeleteCoverImage).toHaveBeenCalledWith(
        "http://localhost:54321/storage/v1/object/public/trip-covers/trip-1/img.jpg",
      );
    });
  });

  describe("POST /api/trips/:id/cover-image", () => {
    it("returns 400 when no file is provided", async () => {
      const app = createTestApp(tripRoutes, "/api/trips");
      const formData = new FormData();

      const res = await app.request("/api/trips/trip-1/cover-image", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("File is required");
    });

    it("returns 400 when file validation fails", async () => {
      mockValidateCoverImage.mockReturnValue("JPEG, PNG, WebP only");

      const app = createTestApp(tripRoutes, "/api/trips");
      const formData = new FormData();
      formData.append("file", new File(["data"], "test.gif", { type: "image/gif" }));

      const res = await app.request("/api/trips/trip-1/cover-image", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("JPEG, PNG, WebP only");
    });

    it("returns 500 when upload fails", async () => {
      mockValidateCoverImage.mockReturnValue(null);
      mockDbQuery.trips.findFirst.mockResolvedValue({ coverImageUrl: null });
      mockUploadCoverImage.mockRejectedValue(new Error("Storage error"));

      const app = createTestApp(tripRoutes, "/api/trips");
      const formData = new FormData();
      formData.append("file", new File(["data"], "test.jpg", { type: "image/jpeg" }));

      const res = await app.request("/api/trips/trip-1/cover-image", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(500);
    });

    it("returns 404 when user is not a member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(tripRoutes, "/api/trips");
      const formData = new FormData();
      formData.append("file", new File(["data"], "test.jpg", { type: "image/jpeg" }));

      const res = await app.request("/api/trips/trip-1/cover-image", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(404);
    });

    it("uploads file and returns coverImageUrl", async () => {
      mockValidateCoverImage.mockReturnValue(null);
      mockDbQuery.trips.findFirst.mockResolvedValue({ coverImageUrl: null });
      mockUploadCoverImage.mockResolvedValue(
        "http://localhost:54321/storage/v1/object/public/trip-covers/trip-1/new.jpg",
      );
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                coverImageUrl:
                  "http://localhost:54321/storage/v1/object/public/trip-covers/trip-1/new.jpg",
              },
            ]),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const formData = new FormData();
      formData.append("file", new File(["data"], "test.jpg", { type: "image/jpeg" }));

      const res = await app.request("/api/trips/trip-1/cover-image", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.coverImageUrl).toContain("trip-covers");
    });

    it("deletes old cover image before uploading new one", async () => {
      const oldUrl = "http://localhost:54321/storage/v1/object/public/trip-covers/trip-1/old.jpg";
      mockValidateCoverImage.mockReturnValue(null);
      mockDbQuery.trips.findFirst.mockResolvedValue({ coverImageUrl: oldUrl });
      mockDeleteCoverImage.mockResolvedValue(undefined);
      mockUploadCoverImage.mockResolvedValue(
        "http://localhost:54321/storage/v1/object/public/trip-covers/trip-1/new.jpg",
      );
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                coverImageUrl:
                  "http://localhost:54321/storage/v1/object/public/trip-covers/trip-1/new.jpg",
              },
            ]),
          }),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const formData = new FormData();
      formData.append("file", new File(["data"], "test.jpg", { type: "image/jpeg" }));

      const res = await app.request("/api/trips/trip-1/cover-image", {
        method: "POST",
        body: formData,
      });

      expect(res.status).toBe(200);
      expect(mockDeleteCoverImage).toHaveBeenCalledWith(oldUrl);
    });
  });

  describe("DELETE /api/trips/:id/cover-image", () => {
    it("deletes cover image and clears DB field", async () => {
      const url = "http://localhost:54321/storage/v1/object/public/trip-covers/trip-1/img.jpg";
      mockDbQuery.trips.findFirst.mockResolvedValue({ coverImageUrl: url });
      mockDeleteCoverImage.mockResolvedValue(undefined);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1/cover-image", {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      expect(mockDeleteCoverImage).toHaveBeenCalledWith(url);
    });

    it("returns 404 when user is viewer", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: fakeUser.id,
        role: "viewer",
      });

      const app = createTestApp(tripRoutes, "/api/trips");
      const res = await app.request("/api/trips/trip-1/cover-image", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });
});
