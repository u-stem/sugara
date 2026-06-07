import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-helpers";

const {
  mockGetSession,
  mockDbQuery,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockDbSelect,
  mockCreateNotification,
  mockNotifyUsers,
  mockNotifyArticleOwnersOnMemberAdded,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbQuery: {
    tripMembers: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    users: {
      findFirst: vi.fn(),
    },
    trips: {
      findFirst: vi.fn(),
    },
    articleTrips: {
      findMany: vi.fn(),
    },
  },
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbDelete: vi.fn(),
  mockDbSelect: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockNotifyUsers: vi.fn(),
  mockNotifyArticleOwnersOnMemberAdded: vi.fn(),
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

vi.mock("../lib/notifications", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
  notifyUsers: (...args: unknown[]) => mockNotifyUsers(...args),
  // C-2 helper — mocked so tests verify the call boundary, not internal DB queries.
  notifyArticleOwnersOnMemberAdded: (...args: unknown[]) =>
    mockNotifyArticleOwnersOnMemberAdded(...args),
}));

import { MAX_MEMBERS_PER_TRIP } from "@sugara/shared";
import { articleTrips } from "../db/schema";
import { memberRoutes } from "../routes/members";

const fakeUserId = "00000000-0000-0000-0000-000000000001";
const fakeUser = { id: fakeUserId, name: "Test User", email: "test@sugara.local" };
const fakeUser2Id = "00000000-0000-0000-0000-000000000002";
const tripId = "trip-1";
const basePath = `/api/trips/${tripId}/members`;

describe("Member routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
    // Default: user is owner
    mockDbQuery.tripMembers.findFirst.mockResolvedValue({
      tripId,
      userId: fakeUserId,
      role: "owner",
    });
    mockDbQuery.trips.findFirst.mockResolvedValue({ title: "テスト旅行" });
    mockCreateNotification.mockResolvedValue(undefined);
    mockNotifyUsers.mockReturnValue(undefined);
    mockNotifyArticleOwnersOnMemberAdded.mockResolvedValue(undefined);
    // Default: no articles linked to the trip (C-2 / C-3 safe default)
    mockDbQuery.articleTrips.findMany.mockResolvedValue([]);
    // Default: count query returns 0 (under limit / no expenses)
    const mockWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
        leftJoin: vi.fn().mockReturnValue({ where: mockWhere }),
      }),
    });
  });

  describe(`GET ${basePath}`, () => {
    it("returns list of members", async () => {
      const members = [
        {
          userId: fakeUserId,
          role: "owner",
          user: { id: fakeUserId, name: "Owner" },
        },
        {
          userId: fakeUser2Id,
          role: "editor",
          user: { id: fakeUser2Id, name: "Editor" },
        },
      ];
      mockDbQuery.tripMembers.findMany.mockResolvedValue(members);

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(basePath);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body[0].role).toBe("owner");
      expect(body[1].name).toBe("Editor");
    });

    it("returns 404 when user is not a member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(basePath);

      expect(res.status).toBe(404);
    });

    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(basePath);

      expect(res.status).toBe(401);
    });
  });

  describe(`POST ${basePath}`, () => {
    it("returns 201 when adding a member", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: fakeUser2Id,
        name: "New Member",
      });
      // No existing membership (second call after owner check)
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce(undefined);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: fakeUser2Id, role: "editor" }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.userId).toBe(fakeUser2Id);
      expect(body.role).toBe("editor");
      expect(body.name).toBe("New Member");
    });

    it("returns 404 when user is editor (not owner)", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId,
        userId: fakeUserId,
        role: "editor",
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: fakeUser2Id, role: "editor" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when target user not found", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: fakeUser2Id, role: "editor" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when user is already a member", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: fakeUser2Id,
        name: "Existing",
      });
      // First call: owner check; second call: existing member found
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce({ tripId, userId: fakeUser2Id, role: "editor" });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: fakeUser2Id, role: "editor" }),
      });

      expect(res.status).toBe(409);
    });

    it("returns 400 with invalid userId", async () => {
      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "not-a-uuid", role: "editor" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 409 when member limit reached", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_MEMBERS_PER_TRIP }]),
        }),
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: fakeUser2Id, role: "editor" }),
      });

      expect(res.status).toBe(409);
    });

    it("POST: メンバー追加時に createNotification を呼ぶ", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: fakeUser2Id,
        name: "New Member",
      });
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce(undefined);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: fakeUser2Id, role: "editor" }),
      });

      expect(mockNotifyUsers).toHaveBeenCalledWith(
        expect.objectContaining({ type: "member_added" }),
      );
    });

    // C-2: members.ts delegates to the helper; verify correct arguments are forwarded.
    it("POST: メンバー追加時に notifyArticleOwnersOnMemberAdded を呼ぶ", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: fakeUser2Id,
        name: "New Member",
      });
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce(undefined);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: fakeUser2Id, role: "editor" }),
      });

      // The helper must be called with the added user and actor suppression.
      expect(mockNotifyArticleOwnersOnMemberAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId,
          addedUserIds: [fakeUser2Id],
          memberName: "New Member",
          excludeOwnerId: fakeUserId,
        }),
      );
    });

    it("POST: 公開記事が紐づいている場合は article_shared_member_added を送らない", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: fakeUser2Id,
        name: "New Member",
      });
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce(undefined);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });
      // Trip has only a public article — public-article filtering happens inside
      // the helper; here we confirm notifyUsers is never called directly with
      // article_shared_member_added (the helper is mocked to a no-op).
      mockDbQuery.articleTrips.findMany.mockResolvedValue([
        {
          article: {
            id: "article-uuid-2",
            ownerId: "00000000-0000-0000-0000-000000000099",
            title: "Public Article",
            visibility: "public",
          },
        },
      ]);

      const app = createTestApp(memberRoutes, "/api/trips");
      await app.request(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: fakeUser2Id, role: "editor" }),
      });

      expect(mockNotifyUsers).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "article_shared_member_added" }),
      );
    });
  });

  describe(`PATCH ${basePath}/:userId`, () => {
    it("returns ok when updating role", async () => {
      // First call: owner check; second call: target member exists (with user for activity log)
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce({
          tripId,
          userId: fakeUser2Id,
          role: "editor",
          user: { name: "Editor" },
        });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${fakeUser2Id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "viewer" }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 400 when trying to change own role", async () => {
      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${fakeUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "viewer" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when user is not owner", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId,
        userId: fakeUserId,
        role: "editor",
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${fakeUser2Id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "viewer" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe(`DELETE ${basePath}/:userId`, () => {
    it("returns ok when removing a member", async () => {
      // First call: owner check; second call: target member exists (with user for activity log)
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce({
          tripId,
          userId: fakeUser2Id,
          role: "editor",
          user: { name: "Editor" },
        });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${fakeUser2Id}`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 409 when member has expenses", async () => {
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce({
          tripId,
          userId: fakeUser2Id,
          role: "editor",
          user: { name: "Editor" },
        });
      // Override select mock to return expense count > 0
      const mockExpenseWhere = vi.fn().mockResolvedValue([{ count: 1 }]);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: mockExpenseWhere,
          leftJoin: vi.fn().mockReturnValue({ where: mockExpenseWhere }),
        }),
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${fakeUser2Id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(409);
    });

    it("returns 400 when trying to remove self", async () => {
      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${fakeUserId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when user is not owner", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId,
        userId: fakeUserId,
        role: "viewer",
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${fakeUser2Id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    // C-3: article_trips cleanup when member has articles linked to the trip
    it("DELETE: 離脱メンバーが保有する記事の article_trips リンクを削除する", async () => {
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce({
          tripId,
          userId: fakeUser2Id,
          role: "editor",
          user: { name: "Editor" },
        });

      // C-3: select returns one article owned by the departing member
      const mockWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
      mockDbSelect
        // First call: expense check (inside transaction)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: mockWhere,
            leftJoin: vi.fn().mockReturnValue({ where: mockWhere }),
          }),
        })
        // Second call: articles owned by departing user
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: "article-uuid-1" }]),
          }),
        });

      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${fakeUser2Id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      // delete called twice: once for articleTrips, once for tripMembers
      expect(mockDbDelete).toHaveBeenCalledTimes(2);
      // First delete must target articleTrips (not a blanket delete of another table)
      expect(mockDbDelete).toHaveBeenCalledWith(articleTrips);
    });

    it("DELETE: 離脱メンバーが記事を持たない場合は article_trips を削除しない", async () => {
      mockDbQuery.tripMembers.findFirst
        .mockResolvedValueOnce({ tripId, userId: fakeUserId, role: "owner" })
        .mockResolvedValueOnce({
          tripId,
          userId: fakeUser2Id,
          role: "editor",
          user: { name: "Editor" },
        });

      // select returns empty articles list for departing user
      const mockWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
      mockDbSelect
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: mockWhere,
            leftJoin: vi.fn().mockReturnValue({ where: mockWhere }),
          }),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        });

      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(memberRoutes, "/api/trips");
      const res = await app.request(`${basePath}/${fakeUser2Id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      // delete called only once: just tripMembers, no articleTrips to remove
      expect(mockDbDelete).toHaveBeenCalledTimes(1);
      // articleTrips must NOT have been touched
      expect(mockDbDelete).not.toHaveBeenCalledWith(articleTrips);
    });
  });
});
