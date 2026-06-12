import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-helpers";

const { mockGetSession, mockDbQuery, mockDbInsert, mockDbDelete, mockDbUpdate, mockDbSelect } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockDbQuery: {
      groups: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      groupMembers: {
        findFirst: vi.fn(),
      },
      users: {
        findFirst: vi.fn(),
      },
    },
    mockDbInsert: vi.fn(),
    mockDbDelete: vi.fn(),
    mockDbUpdate: vi.fn(),
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
    delete: (...args: unknown[]) => mockDbDelete(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
  };
  return {
    db: { ...tx, transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});

import { ERROR_CODE, MAX_GROUPS_PER_USER, MAX_MEMBERS_PER_GROUP } from "@sugara/shared";
import { groupRoutes } from "../routes/groups";

const userId = "00000000-0000-0000-0000-000000000001";
const otherUserId = "00000000-0000-0000-0000-000000000002";
const groupId = "00000000-0000-0000-0000-000000000010";
const fakeUser = { id: userId, name: "Test User", email: "test@sugara.local" };

function setupCountQuery(countValue: number) {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ count: countValue }]),
    }),
  });
}

describe("Group routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      user: fakeUser,
      session: { id: "session-1" },
    });
    setupCountQuery(0);
  });

  // --- GET /api/groups ---
  describe("GET /api/groups", () => {
    it("returns owned groups with member count", async () => {
      mockDbQuery.groups.findMany.mockResolvedValue([
        {
          id: groupId,
          ownerId: userId,
          name: "Family",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          members: [{ userId: otherUserId }],
        },
      ]);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request("/api/groups");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(groupId);
      expect(body[0].name).toBe("Family");
      expect(body[0].memberCount).toBe(1);
    });

    it("returns empty array when no groups", async () => {
      mockDbQuery.groups.findMany.mockResolvedValue([]);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request("/api/groups");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual([]);
    });

    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request("/api/groups");

      expect(res.status).toBe(401);
    });
  });

  // --- POST /api/groups ---
  describe("POST /api/groups", () => {
    it("returns 201 on successful creation", async () => {
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: groupId,
              name: "Family",
              createdAt: "2025-01-01T00:00:00.000Z",
              updatedAt: "2025-01-01T00:00:00.000Z",
            },
          ]),
        }),
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Family" }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.id).toBe(groupId);
      expect(body.name).toBe("Family");
    });

    it("returns 400 with empty name", async () => {
      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 409 when group limit reached", async () => {
      setupCountQuery(MAX_GROUPS_PER_USER);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Family" }),
      });

      expect(res.status).toBe(409);
    });
  });

  // --- PATCH /api/groups/:groupId ---
  describe("PATCH /api/groups/:groupId", () => {
    it("returns 200 on successful update", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: groupId,
                name: "New Name",
                createdAt: "2025-01-01T00:00:00.000Z",
                updatedAt: "2025-01-01T00:00:00.000Z",
              },
            ]),
          }),
        }),
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.name).toBe("New Name");
    });

    it("returns 404 when group not found", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when not owner", async () => {
      // verifyGroupOwnership filters by ownerId, so non-owner gets undefined
      mockDbQuery.groups.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE /api/groups/:groupId ---
  describe("DELETE /api/groups/:groupId", () => {
    it("returns 200 on successful deletion", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 404 when group not found", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when not owner", async () => {
      // verifyGroupOwnership filters by ownerId, so non-owner gets undefined
      mockDbQuery.groups.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  // --- GET /api/groups/:groupId/members ---
  describe("GET /api/groups/:groupId/members", () => {
    it("returns members list", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
        members: [
          {
            userId: otherUserId,
            addedAt: "2025-01-01T00:00:00.000Z",
            user: { id: otherUserId, name: "Friend A", image: null },
          },
        ],
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].userId).toBe(otherUserId);
      expect(body[0].name).toBe("Friend A");
    });

    it("returns 404 when not owner", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`);

      expect(res.status).toBe(404);
    });
  });

  // --- POST /api/groups/:groupId/members ---
  describe("POST /api/groups/:groupId/members", () => {
    it("returns 201 on successful addition", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: otherUserId,
        name: "Friend A",
      });
      mockDbQuery.groupMembers.findFirst.mockResolvedValue(undefined);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: otherUserId }),
      });

      expect(res.status).toBe(201);
    });

    it("returns 404 when group not owned", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: otherUserId }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when target user not found", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbQuery.users.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: otherUserId }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when already a member", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: otherUserId,
        name: "Friend A",
      });
      setupCountQuery(0);
      const pgError = new Error("duplicate key");
      Object.assign(pgError, { code: "23505" });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockRejectedValue(pgError),
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: otherUserId }),
      });

      expect(res.status).toBe(409);
    });

    it("returns ALREADY_GROUP_MEMBER code when already a member", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: otherUserId,
        name: "Friend A",
      });
      setupCountQuery(0);
      const pgError = new Error("duplicate key");
      Object.assign(pgError, { code: "23505" });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockRejectedValue(pgError),
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: otherUserId }),
      });
      const body = await res.json();

      expect(body.code).toBe(ERROR_CODE.ALREADY_GROUP_MEMBER);
    });

    it("returns 409 when member limit reached", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: otherUserId,
        name: "Friend A",
      });
      mockDbQuery.groupMembers.findFirst.mockResolvedValue(undefined);
      setupCountQuery(MAX_MEMBERS_PER_GROUP);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: otherUserId }),
      });

      expect(res.status).toBe(409);
    });

    it("returns LIMIT_GROUP_MEMBERS code when member limit reached", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: otherUserId,
        name: "Friend A",
      });
      setupCountQuery(MAX_MEMBERS_PER_GROUP);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: otherUserId }),
      });
      const body = await res.json();

      expect(body.code).toBe(ERROR_CODE.LIMIT_GROUP_MEMBERS);
    });

    it("returns details.max equal to MAX_MEMBERS_PER_GROUP when limit reached", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: otherUserId,
        name: "Friend A",
      });
      setupCountQuery(MAX_MEMBERS_PER_GROUP);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: otherUserId }),
      });
      const body = await res.json();

      expect(body.details.max).toBe(MAX_MEMBERS_PER_GROUP);
    });
  });

  // --- POST /api/groups/:groupId/members/bulk ---
  describe("POST /api/groups/:groupId/members/bulk", () => {
    const user3 = "00000000-0000-0000-0000-000000000003";
    const user4 = "00000000-0000-0000-0000-000000000004";

    function setupBulkMocks({
      currentCount = 0,
      existingMemberIds = [] as string[],
      validUserIds = [] as string[],
    }) {
      // 1st select: member count
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: currentCount }]),
        }),
      });
      // 2nd select: existing members
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(existingMemberIds.map((id) => ({ userId: id }))),
        }),
      });
      // 3rd select: valid users
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(validUserIds.map((id) => ({ id }))),
        }),
      });
    }

    it("returns 201 and adds multiple members", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      setupBulkMocks({
        currentCount: 0,
        existingMemberIds: [],
        validUserIds: [otherUserId, user3],
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [otherUserId, user3] }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.added).toBe(2);
      expect(body.failed).toBe(0);
    });

    it("skips already-members and non-existent users", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      setupBulkMocks({
        currentCount: 1,
        existingMemberIds: [otherUserId],
        validUserIds: [user3],
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // otherUserId: already member, user3: valid, user4: non-existent
        body: JSON.stringify({ userIds: [otherUserId, user3, user4] }),
      });
      const body = await res.json();

      expect(res.status).toBe(201);
      expect(body.added).toBe(1);
      expect(body.failed).toBe(2);
    });

    it("returns 404 when group not owned", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [otherUserId] }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 400 with empty array", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 409 when member limit already reached", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      setupCountQuery(MAX_MEMBERS_PER_GROUP);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [otherUserId] }),
      });

      expect(res.status).toBe(409);
    });
  });

  // --- DELETE /api/groups/:groupId/members/:userId ---
  describe("DELETE /api/groups/:groupId/members/:userId", () => {
    it("returns 200 on successful removal", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbQuery.groupMembers.findFirst.mockResolvedValue({
        groupId,
        userId: otherUserId,
      });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members/${otherUserId}`, {
        method: "DELETE",
      });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("returns 404 when member not found", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue({
        id: groupId,
        ownerId: userId,
        name: "Family",
      });
      mockDbQuery.groupMembers.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members/${otherUserId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when group not owned", async () => {
      mockDbQuery.groups.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(groupRoutes, "/api/groups");
      const res = await app.request(`/api/groups/${groupId}/members/${otherUserId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });
});
