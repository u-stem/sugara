import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-helpers";

const { mockGetSession, mockDbQuery, mockDbInsert, mockDbDelete, mockDbUpdate, mockDbSelect } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockDbQuery: {
      bookmarkLists: { findFirst: vi.fn() },
      bookmarks: { findMany: vi.fn(), findFirst: vi.fn() },
      schedules: { findMany: vi.fn() },
      tripMembers: { findFirst: vi.fn() },
    },
    mockDbInsert: vi.fn(),
    mockDbDelete: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockDbSelect: vi.fn(),
  }));

vi.mock("../lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
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

import { MAX_BOOKMARKS_PER_LIST } from "@sugara/shared";
import { bookmarkRoutes } from "../routes/bookmarks";

const userId = "00000000-0000-0000-0000-000000000001";
const otherUserId = "00000000-0000-0000-0000-000000000002";
const fakeUser = { id: userId, name: "Test User", email: "test@sugara.local" };
const listId = "00000000-0000-0000-0000-000000000010";
const bookmarkId = "00000000-0000-0000-0000-000000000020";

describe("Bookmark routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: fakeUser, session: { id: "session-1" } });
    mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({ id: listId, userId });
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    });
  });

  // --- GET ---
  describe("GET /:listId/bookmarks", () => {
    it("returns bookmarks for own list", async () => {
      mockDbQuery.bookmarks.findMany.mockResolvedValue([
        {
          id: bookmarkId,
          name: "Cafe A",
          memo: null,
          urls: [],
          sortOrder: 0,
          listId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("Cafe A");
    });

    it("returns 404 when list not owned", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({ id: listId, userId: otherUserId });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks`);

      expect(res.status).toBe(404);
    });

    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks`);

      expect(res.status).toBe(401);
    });
  });

  // --- POST ---
  describe("POST /:listId/bookmarks", () => {
    it("creates bookmark with 201", async () => {
      const created = {
        id: bookmarkId,
        name: "Cafe A",
        memo: null,
        urls: [],
        sortOrder: 0,
        listId,
      };
      // First select: COUNT (limit check); second: COALESCE(MAX(sortOrder), -1) (#143)
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 3 }]),
        }),
      });
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ max: 2 }]),
        }),
      });
      const insertValues = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([created]),
      });
      mockDbInsert.mockReturnValue({ values: insertValues });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Cafe A" }),
      });

      expect(res.status).toBe(201);
      // MAX(sortOrder)=2 -> new bookmark gets 3 (gap-safe MAX+1, not COUNT)
      expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 3 }));
    });

    it("returns 409 when bookmark limit reached", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_BOOKMARKS_PER_LIST }]),
        }),
      });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      });

      expect(res.status).toBe(409);
    });

    it("returns 400 with empty name", async () => {
      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when list not owned", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({ id: listId, userId: otherUserId });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      });

      expect(res.status).toBe(404);
    });
  });

  // --- PATCH ---
  describe("PATCH /:listId/bookmarks/:bookmarkId", () => {
    it("updates bookmark", async () => {
      const existing = { id: bookmarkId, listId, name: "Old" };
      mockDbQuery.bookmarks.findFirst.mockResolvedValue(existing);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...existing, name: "New" }]),
          }),
        }),
      });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/${bookmarkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 404 when bookmark not found", async () => {
      mockDbQuery.bookmarks.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/${bookmarkId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New" }),
      });

      expect(res.status).toBe(404);
    });
  });

  // --- DELETE ---
  describe("DELETE /:listId/bookmarks/:bookmarkId", () => {
    it("deletes bookmark", async () => {
      mockDbQuery.bookmarks.findFirst.mockResolvedValue({ id: bookmarkId, listId });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/${bookmarkId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
    });

    it("returns 404 when bookmark not found", async () => {
      mockDbQuery.bookmarks.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/${bookmarkId}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  // --- BATCH DELETE ---
  describe("POST /:listId/bookmarks/batch-delete", () => {
    const bm1 = "00000000-0000-0000-0000-000000000021";
    const bm2 = "00000000-0000-0000-0000-000000000022";

    it("deletes multiple bookmarks", async () => {
      mockDbQuery.bookmarks.findMany.mockResolvedValue([
        { id: bm1, listId },
        { id: bm2, listId },
      ]);
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1, bm2] }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("returns 400 with empty bookmarkIds", async () => {
      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 when some bookmarks not in list", async () => {
      mockDbQuery.bookmarks.findMany.mockResolvedValue([{ id: bm1, listId }]);

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1, bm2] }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when list not owned", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({ id: listId, userId: otherUserId });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1] }),
      });

      expect(res.status).toBe(404);
    });
  });

  // --- BATCH DUPLICATE ---
  describe("POST /:listId/bookmarks/batch-duplicate", () => {
    const bm1 = "00000000-0000-0000-0000-000000000021";
    const bm2 = "00000000-0000-0000-0000-000000000022";

    it("duplicates bookmarks with 201", async () => {
      mockDbQuery.bookmarks.findMany.mockResolvedValue([
        {
          id: bm1,
          listId,
          name: "Cafe A",
          memo: "note",
          urls: ["https://example.com"],
          sortOrder: 0,
        },
        { id: bm2, listId, name: "Cafe B", memo: null, urls: [], sortOrder: 1 },
      ]);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 2 }]),
        }),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1, bm2] }),
      });

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("returns 409 when limit exceeded", async () => {
      mockDbQuery.bookmarks.findMany.mockResolvedValue([
        { id: bm1, listId, name: "Cafe A", memo: null, urls: [], sortOrder: 0 },
      ]);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_BOOKMARKS_PER_LIST }]),
        }),
      });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1] }),
      });

      expect(res.status).toBe(409);
    });

    it("returns 404 when some bookmarks not in list", async () => {
      mockDbQuery.bookmarks.findMany.mockResolvedValue([{ id: bm1, listId }]);

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1, bm2] }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when list not owned", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({ id: listId, userId: otherUserId });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/batch-duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookmarkIds: [bm1] }),
      });

      expect(res.status).toBe(404);
    });
  });

  // --- FROM SCHEDULES ---
  describe("POST /:listId/bookmarks/from-schedules", () => {
    const tripId = "00000000-0000-0000-0000-000000000099";
    const s1 = "00000000-0000-0000-0000-000000000041";
    const s2 = "00000000-0000-0000-0000-000000000042";

    beforeEach(() => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({
        tripId,
        userId,
        role: "viewer",
      });
    });

    it("saves schedules as bookmarks with 201", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([
        { id: s1, tripId, name: "Spot A", memo: "note", urls: ["https://a.com"] },
        { id: s2, tripId, name: "Spot B", memo: null, urls: [] },
      ]);
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/from-schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, scheduleIds: [s1, s2] }),
      });

      expect(res.status).toBe(201);
    });

    it("returns 404 when list not owned", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({ id: listId, userId: otherUserId });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/from-schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, scheduleIds: [s1] }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when not a trip member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(null);

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/from-schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, scheduleIds: [s1] }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 404 when schedules not in trip", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([]);

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/from-schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, scheduleIds: [s1] }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 409 when bookmark limit exceeded", async () => {
      mockDbQuery.schedules.findMany.mockResolvedValue([
        { id: s1, tripId, name: "Spot A", memo: null, urls: [] },
      ]);
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_BOOKMARKS_PER_LIST }]),
        }),
      });

      const app = createTestApp(bookmarkRoutes, "/api/bookmark-lists");
      const res = await app.request(`/api/bookmark-lists/${listId}/bookmarks/from-schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, scheduleIds: [s1] }),
      });

      expect(res.status).toBe(409);
    });
  });
});
