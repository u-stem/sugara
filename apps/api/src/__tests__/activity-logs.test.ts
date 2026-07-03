import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockDbQuery, mockDbSelect, mockDbInsert, mockDbDelete } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockDbQuery: {
      tripMembers: {
        findFirst: vi.fn(),
      },
    },
    mockDbSelect: vi.fn(),
    mockDbInsert: vi.fn(),
    mockDbDelete: vi.fn(),
  }),
);

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
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
}));

import { MAX_LOGS_PER_TRIP } from "../lib/constants";
import { activityLogRoutes } from "../routes/activity-logs";
import { createTestApp, TEST_USER } from "./test-helpers";

const fakeUser = TEST_USER;
const tripId = "trip-1";
const basePath = `/api/trips/${tripId}/activity-logs`;

describe("Activity log routes", () => {
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

  describe(`GET ${basePath}`, () => {
    it("returns activity logs", async () => {
      const logs = [
        {
          id: "log-1",
          userId: fakeUser.id,
          userName: "Test User",
          action: "created",
          entityType: "schedule",
          entityName: "Tokyo Tower",
          detail: null,
          createdAt: new Date("2025-01-01T10:00:00Z"),
        },
      ];
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(logs),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(activityLogRoutes, "/api/trips");
      const res = await app.request(basePath);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].action).toBe("created");
      expect(body.items[0].entityName).toBe("Tokyo Tower");
      expect(body.nextCursor).toBeNull();
    });

    it("returns paginated results with cursor", async () => {
      const baseTime = new Date("2025-06-01T10:00:00Z").getTime();
      const logs = Array.from({ length: 51 }, (_, i) => ({
        id: `log-${i}`,
        userId: fakeUser.id,
        userName: "Test User",
        action: "created",
        entityType: "schedule",
        entityName: `Item ${i}`,
        detail: null,
        createdAt: new Date(baseTime - i * 3600000),
      }));
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(logs),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(activityLogRoutes, "/api/trips");
      const res = await app.request(basePath);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(50);
      expect(body.nextCursor).toBeTruthy();
    });

    it("viewer can access activity logs", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId,
        userId: fakeUser.id,
        role: "viewer",
      });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(activityLogRoutes, "/api/trips");
      const res = await app.request(basePath);

      expect(res.status).toBe(200);
    });

    it("returns 404 for non-member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(null);

      const app = createTestApp(activityLogRoutes, "/api/trips");
      const res = await app.request(basePath);

      expect(res.status).toBe(404);
    });

    it("respects limit parameter", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(activityLogRoutes, "/api/trips");
      const res = await app.request(`${basePath}?limit=10`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.items).toHaveLength(0);
    });

    // Number("abc") is NaN, and NaN survives Math.min/Math.max — without a
    // guard it reaches the SQL LIMIT clause and the query 500s.
    it("falls back to the default for a non-numeric limit", async () => {
      const limitFn = vi.fn().mockResolvedValue([]);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: limitFn,
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(activityLogRoutes, "/api/trips");
      await app.request(`${basePath}?limit=abc`);

      // hasMore probing queries limit + 1
      expect(limitFn).toHaveBeenCalledWith(MAX_LOGS_PER_TRIP + 1);
    });

    it("floors a fractional limit to an integer", async () => {
      const limitFn = vi.fn().mockResolvedValue([]);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: limitFn,
              }),
            }),
          }),
        }),
      });

      const app = createTestApp(activityLogRoutes, "/api/trips");
      await app.request(`${basePath}?limit=2.5`);

      expect(limitFn).toHaveBeenCalledWith(3);
    });
  });
});
