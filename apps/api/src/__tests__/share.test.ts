import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockDbQuery, mockDbUpdate } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbQuery: {
    trips: {
      findFirst: vi.fn(),
    },
    tripMembers: {
      findFirst: vi.fn(),
    },
  },
  mockDbUpdate: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("../db/index", () => ({
  db: {
    query: mockDbQuery,
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

import { shareRoutes } from "../routes/share";
import { createTestApp, TEST_USER } from "./test-helpers";

const fakeUser = TEST_USER;

describe("Share routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
    // Default: user is the owner
    mockDbQuery.tripMembers.findFirst.mockResolvedValue({
      tripId: "trip-1",
      userId: fakeUser.id,
      role: "owner",
    });
  });

  describe("POST /api/trips/:id/share", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/trips/trip-1/share", {
        method: "POST",
      });

      expect(res.status).toBe(401);
    });

    it("returns 404 when user is not owner", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/trips/trip-1/share", {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when user is editor (not owner)", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: fakeUser.id,
        role: "editor",
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/trips/trip-1/share", {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });

    it("returns existing shareToken with expiresAt if already set", async () => {
      const existingToken = "abc123existingtoken";
      const expiresAt = new Date("2099-12-31T00:00:00.000Z");
      mockDbQuery.trips.findFirst.mockResolvedValue({
        shareToken: existingToken,
        shareTokenExpiresAt: expiresAt,
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/trips/trip-1/share", {
        method: "POST",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.shareToken).toBe(existingToken);
      expect(body.shareTokenExpiresAt).toBe(expiresAt.toISOString());
    });

    it("generates new token for legacy token without expiry", async () => {
      const generatedToken = "abc123newtoken";
      const expiresAt = new Date("2026-03-01T00:00:00.000Z");
      mockDbQuery.trips.findFirst.mockResolvedValue({
        shareToken: "legacy-token",
        shareTokenExpiresAt: null,
      });

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ shareToken: generatedToken, shareTokenExpiresAt: expiresAt }]),
          }),
        }),
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/trips/trip-1/share", {
        method: "POST",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.shareToken).toBe(generatedToken);
      expect(body.shareTokenExpiresAt).toBe(expiresAt.toISOString());
    });

    it("generates a new shareToken with expiresAt when not set", async () => {
      const generatedToken = "abc123generated";
      const expiresAt = new Date("2026-03-01T00:00:00.000Z");
      mockDbQuery.trips.findFirst.mockResolvedValue({
        shareToken: null,
      });

      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ shareToken: generatedToken, shareTokenExpiresAt: expiresAt }]),
          }),
        }),
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/trips/trip-1/share", {
        method: "POST",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.shareToken).toBe(generatedToken);
      expect(body.shareTokenExpiresAt).toBe(expiresAt.toISOString());
    });
  });

  describe("PUT /api/trips/:id/share", () => {
    it("regenerates share token", async () => {
      const newToken = "regenerated-token";
      const expiresAt = new Date("2026-03-01T00:00:00.000Z");
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValue([{ shareToken: newToken, shareTokenExpiresAt: expiresAt }]),
          }),
        }),
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/trips/trip-1/share", {
        method: "PUT",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.shareToken).toBe(newToken);
      expect(body.shareTokenExpiresAt).toBe(expiresAt.toISOString());
    });

    it("returns 404 when user is not owner", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId: "trip-1",
        userId: fakeUser.id,
        role: "editor",
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/trips/trip-1/share", {
        method: "PUT",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/shared/:token", () => {
    it("returns 404 with invalid token", async () => {
      mockDbQuery.trips.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/shared/invalid-token");

      expect(res.status).toBe(404);
    });

    it("returns trip without sensitive fields", async () => {
      const sharedTrip = {
        id: "trip-1",
        ownerId: "user-1",
        shareToken: "valid-token",
        shareTokenExpiresAt: new Date("2030-01-01"),
        title: "Tokyo Trip",
        destination: "Tokyo",
        startDate: "2025-07-01",
        endDate: "2025-07-03",
        days: [],
        schedules: [],
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(sharedTrip);

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/shared/valid-token");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.title).toBe("Tokyo Trip");
      expect(body.ownerId).toBeUndefined();
      expect(body.shareToken).toBeUndefined();
      expect(body.shareTokenExpiresAt).toBeUndefined();
    });

    it("returns candidates (schedules without dayPatternId) in response", async () => {
      const sharedTrip = {
        id: "trip-1",
        ownerId: "user-1",
        shareToken: "valid-token",
        shareTokenExpiresAt: new Date("2030-01-01"),
        title: "Tokyo Trip",
        destination: "Tokyo",
        startDate: "2025-07-01",
        endDate: "2025-07-03",
        days: [],
        schedules: [
          {
            id: "sched-1",
            name: "Senso-ji Temple",
            category: "sightseeing",
            dayPatternId: null,
            address: "Asakusa",
            memo: null,
            urls: [],
            startTime: null,
            endTime: null,
            color: "blue",
            sortOrder: 0,
          },
          {
            id: "sched-2",
            name: "Assigned Schedule",
            category: "restaurant",
            dayPatternId: "pattern-1",
            address: null,
            memo: null,
            urls: [],
            startTime: null,
            endTime: null,
            color: "red",
            sortOrder: 1,
          },
        ],
      };
      mockDbQuery.trips.findFirst.mockResolvedValue(sharedTrip);

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/shared/valid-token");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.candidates).toHaveLength(1);
      expect(body.candidates[0].name).toBe("Senso-ji Temple");
      expect(body.candidates[0].dayPatternId).toBeUndefined();
    });

    it("returns 404 when share link expires at exactly current time", async () => {
      vi.useFakeTimers();
      const now = new Date("2025-06-01T12:00:00.000Z");
      vi.setSystemTime(now);

      mockDbQuery.trips.findFirst.mockResolvedValue({
        id: "trip-1",
        ownerId: "user-1",
        shareToken: "exact-expiry-token",
        shareTokenExpiresAt: now,
        title: "Tokyo Trip",
        destination: "Tokyo",
        days: [],
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/shared/exact-expiry-token");

      expect(res.status).toBe(404);
      vi.useRealTimers();
    });

    it("returns 404 for expired share link", async () => {
      mockDbQuery.trips.findFirst.mockResolvedValue({
        id: "trip-1",
        ownerId: "user-1",
        shareToken: "expired-token",
        shareTokenExpiresAt: new Date("2020-01-01"),
        title: "Tokyo Trip",
        destination: "Tokyo",
        days: [],
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/shared/expired-token");

      expect(res.status).toBe(404);
    });

    it("returns 404 for a legacy share link without an expiry", async () => {
      mockDbQuery.trips.findFirst.mockResolvedValue({
        id: "trip-1",
        ownerId: "user-1",
        shareToken: "legacy-token",
        shareTokenExpiresAt: null,
        title: "Tokyo Trip",
        destination: "Tokyo",
        days: [],
        schedules: [],
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/shared/legacy-token");

      expect(res.status).toBe(404);
    });

    it("does not require authentication", async () => {
      mockGetSession.mockResolvedValue(null);
      mockDbQuery.trips.findFirst.mockResolvedValue({
        id: "trip-1",
        ownerId: "user-1",
        shareToken: "valid-token",
        shareTokenExpiresAt: new Date("2099-01-01"),
        title: "Tokyo Trip",
        destination: "Tokyo",
        days: [],
      });

      const app = createTestApp(shareRoutes, "/");
      const res = await app.request("/api/shared/valid-token");

      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/shared/:token rate limiting", () => {
    it("returns 429 after 30 requests from the same IP", async () => {
      mockDbQuery.trips.findFirst.mockResolvedValue({
        id: "trip-1",
        title: "Test Trip",
        destination: "Tokyo",
        startDate: null,
        endDate: null,
        shareToken: "valid-token",
        shareTokenExpiresAt: new Date("2099-01-01"),
        tripMembers: [],
        tripDays: [],
        ownerId: "user-1",
      });

      const app = createTestApp(shareRoutes, "/");
      const headers = { "x-forwarded-for": "10.0.0.1" };

      for (let i = 0; i < 30; i++) {
        await app.request("/api/shared/valid-token", { headers });
      }

      const res = await app.request("/api/shared/valid-token", { headers });
      expect(res.status).toBe(429);
    });
  });
});
