import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-helpers";

const { mockGetSession, mockDbQuery, mockDbInsert, mockDbDelete, mockDbUpdate, mockDbSelect } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockDbQuery: {
      articles: { findMany: vi.fn(), findFirst: vi.fn() },
      articleTrips: { findMany: vi.fn() },
      tripMembers: { findFirst: vi.fn(), findMany: vi.fn() },
      friends: { findFirst: vi.fn() },
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
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
  };
  return { db: { ...tx, transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } };
});

import { MAX_ARTICLES_PER_USER } from "@sugara/shared";
import { articleDetailRoutes, articleRoutes, tripArticleRoutes } from "../routes/articles";

const userId = "00000000-0000-0000-0000-000000000001";
const otherUserId = "00000000-0000-0000-0000-000000000002";
const fakeUser = { id: userId, name: "Test User", email: "test@sugara.local" };
const articleId = "00000000-0000-0000-0000-000000000010";
const tripId = "00000000-0000-0000-0000-000000000020";

function authed() {
  mockGetSession.mockResolvedValue({ user: fakeUser, session: { id: "session-1" } });
}

describe("Article routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authed();
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ count: 0 }]) }),
    });
  });

  // --- GET /api/articles ---
  describe("GET /api/articles", () => {
    it("returns own articles with like count, omitting content", async () => {
      mockDbQuery.articles.findMany.mockResolvedValue([
        {
          id: articleId,
          ownerId: userId,
          title: "My trip notes",
          content: "secret body",
          tags: ["tokyo"],
          visibility: "private",
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          likes: [{ userId: otherUserId }],
        },
      ]);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body[0].title).toBe("My trip notes");
      expect(body[0].likeCount).toBe(1);
      expect(body[0].content).toBeUndefined();
    });

    it("returns 401 when unauthenticated", async () => {
      mockGetSession.mockResolvedValue(null);
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles");
      expect(res.status).toBe(401);
    });
  });

  // --- POST /api/articles ---
  describe("POST /api/articles", () => {
    it("creates an article with 201", async () => {
      const created = {
        id: articleId,
        ownerId: userId,
        title: "New",
        content: "",
        tags: [],
        visibility: "private",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([created]) }),
      });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.tripIds).toEqual([]);
    });

    it("returns 400 with empty title", async () => {
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 403 for guest accounts", async () => {
      mockGetSession.mockResolvedValue({
        user: { ...fakeUser, isAnonymous: true },
        session: { id: "s" },
      });
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New" }),
      });
      expect(res.status).toBe(403);
    });

    it("returns 409 when article limit reached", async () => {
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: MAX_ARTICLES_PER_USER }]),
        }),
      });
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New" }),
      });
      expect(res.status).toBe(409);
    });
  });

  // --- PATCH /api/articles/reorder (minor-1) ---
  describe("PATCH /api/articles/reorder", () => {
    it("updates sortOrder in a single bulk statement (not N queries)", async () => {
      const id1 = "00000000-0000-0000-0000-000000000011";
      const id2 = "00000000-0000-0000-0000-000000000012";
      mockDbQuery.articles.findMany.mockResolvedValue([{ id: id1 }, { id: id2 }]);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: [id1, id2] }),
      });

      expect(res.status).toBe(200);
      // The bulk approach calls update exactly once regardless of input length.
      expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    });

    it("returns 200 with { ok: true } and skips UPDATE when orderedIds is empty", async () => {
      // Empty list is a valid no-op; must NOT trigger the bulk CASE/WHEN that
      // produces invalid SQL ("CASE  END") and causes a Postgres 500.
      mockDbQuery.articles.findMany.mockResolvedValue([]);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: [] }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      // No UPDATE must be issued — the bulk CASE/WHEN is skipped entirely.
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it("returns 400 when an id does not belong to the user", async () => {
      const ownId = "00000000-0000-0000-0000-000000000011";
      const otherId = "00000000-0000-0000-0000-000000000099";
      mockDbQuery.articles.findMany.mockResolvedValue([{ id: ownId }]);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: [ownId, otherId] }),
      });

      expect(res.status).toBe(400);
    });
  });

  // --- PATCH /api/articles/:id ---
  describe("PATCH /api/articles/:articleId", () => {
    it("returns 404 when not owner", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        likes: [],
        articleTrips: [],
      });
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Hack" }),
      });
      expect(res.status).toBe(404);
    });

    it("updates title and returns the updated article (200)", async () => {
      const now = new Date("2024-01-01T00:00:00Z");
      const existing = {
        id: articleId,
        ownerId: userId,
        title: "Old title",
        content: "body",
        tags: [],
        visibility: "private",
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        likes: [],
        articleTrips: [],
      };
      mockDbQuery.articles.findFirst.mockResolvedValue(existing);
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ ...existing, title: "New title" }]),
          }),
        }),
      });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New title" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe("New title");
    });

    it("returns 200 without UPDATE when no fields changed (hasChanges early return)", async () => {
      const now = new Date("2024-01-01T00:00:00Z");
      const existing = {
        id: articleId,
        ownerId: userId,
        title: "Same title",
        content: "body",
        tags: [],
        visibility: "private",
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
        likes: [],
        articleTrips: [],
      };
      mockDbQuery.articles.findFirst.mockResolvedValue(existing);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Same title" }),
      });

      expect(res.status).toBe(200);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  // --- DELETE /api/articles/:id ---
  describe("DELETE /api/articles/:articleId", () => {
    it("deletes own article and returns { ok: true } (200)", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({ id: articleId, ownerId: userId });
      mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`, { method: "DELETE" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it("returns 404 when the article is owned by another user", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({ id: articleId, ownerId: otherUserId });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`, { method: "DELETE" });

      expect(res.status).toBe(404);
    });
  });

  // --- PUT /api/articles/:id/trips ---
  describe("PUT /api/articles/:articleId/trips", () => {
    it("returns 403 when linking a trip the user is not a member of", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({ id: articleId, ownerId: userId });
      mockDbQuery.tripMembers.findMany.mockResolvedValue([]); // not a member

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}/trips`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripIds: [tripId] }),
      });
      expect(res.status).toBe(403);
    });

    it("replaces trip links when the user is a member", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({ id: articleId, ownerId: userId });
      mockDbQuery.tripMembers.findMany.mockResolvedValue([{ tripId }]);
      mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}/trips`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripIds: [tripId] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tripIds).toEqual([tripId]);
    });

    it("removes all trip links when tripIds is empty", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({ id: articleId, ownerId: userId });
      mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}/trips`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripIds: [] }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.tripIds).toEqual([]);
    });
  });

  // --- GET /api/articles/:id (public detail, visibility) ---
  describe("GET /api/articles/:articleId", () => {
    it("returns a public article to an anonymous viewer", async () => {
      mockGetSession.mockResolvedValue(null);
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        title: "Public",
        content: "body",
        tags: [],
        visibility: "public",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        likes: [],
        articleTrips: [],
      });

      const app = createTestApp(articleDetailRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.content).toBe("body");
      expect(body.tripIds).toEqual([]); // hidden from non-owner
    });

    it("returns 404 for a private article seen by a stranger", async () => {
      mockGetSession.mockResolvedValue(null);
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        title: "Private",
        content: "secret",
        tags: [],
        visibility: "private",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        likes: [],
        articleTrips: [],
      });

      const app = createTestApp(articleDetailRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`);
      expect(res.status).toBe(404);
    });

    it("returns a private article to a member of a linked trip (context sharing)", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        title: "Shared",
        content: "body",
        tags: [],
        visibility: "private",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        likes: [],
        articleTrips: [{ tripId }],
      });
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({ tripId });

      const app = createTestApp(articleDetailRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`);
      expect(res.status).toBe(200);
    });

    it("returns a friends_only article to a friend (200)", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        title: "Friends only",
        content: "body",
        tags: [],
        visibility: "friends_only",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        likes: [],
        articleTrips: [],
      });
      mockDbQuery.friends.findFirst.mockResolvedValue({ id: "friend-1" });

      const app = createTestApp(articleDetailRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`);
      expect(res.status).toBe(200);
    });

    it("returns 404 for a friends_only article to a non-friend", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        title: "Friends only",
        content: "body",
        tags: [],
        visibility: "friends_only",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        likes: [],
        articleTrips: [],
      });
      mockDbQuery.friends.findFirst.mockResolvedValue(undefined);
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(articleDetailRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`);
      expect(res.status).toBe(404);
    });
  });

  // --- POST /api/articles/batch-delete ---
  describe("POST /api/articles/batch-delete", () => {
    const articleId2 = "00000000-0000-0000-0000-000000000011";

    it("deletes multiple own articles and returns ok", async () => {
      mockDbQuery.articles.findMany.mockResolvedValue([{ id: articleId }, { id: articleId2 }]);
      mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleIds: [articleId, articleId2] }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.deleted).toBe(2);
    });

    it("returns 404 when some articles are not owned by the user", async () => {
      // Only 1 found but 2 were requested — the other belongs to a different user.
      mockDbQuery.articles.findMany.mockResolvedValue([{ id: articleId }]);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleIds: [articleId, articleId2] }),
      });

      expect(res.status).toBe(404);
    });

    it("returns 403 for guest accounts", async () => {
      mockGetSession.mockResolvedValue({
        user: { ...fakeUser, isAnonymous: true },
        session: { id: "s" },
      });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleIds: [articleId] }),
      });

      expect(res.status).toBe(403);
    });

    it("returns 400 with empty articleIds (schema validation)", async () => {
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleIds: [] }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 with duplicate articleIds (schema validation)", async () => {
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleIds: [articleId, articleId] }),
      });

      expect(res.status).toBe(400);
    });
  });

  // --- GET /api/trips/:tripId/articles ---
  describe("GET /api/trips/:tripId/articles", () => {
    it("returns 404 when the viewer is not a trip member", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);
      const app = createTestApp(tripArticleRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/articles`);
      expect(res.status).toBe(404);
    });

    it("returns linked articles to a trip member regardless of visibility", async () => {
      mockDbQuery.tripMembers.findFirst.mockResolvedValue({ tripId });
      mockDbQuery.articleTrips.findMany.mockResolvedValue([
        {
          article: {
            id: articleId,
            ownerId: otherUserId,
            title: "Linked private",
            content: "body",
            tags: [],
            visibility: "private",
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            likes: [],
          },
        },
      ]);

      const app = createTestApp(tripArticleRoutes, "/api/trips");
      const res = await app.request(`/api/trips/${tripId}/articles`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe("Linked private");
    });
  });

  // --- POST /api/articles/:id/like ---
  describe("POST /api/articles/:articleId/like", () => {
    it("likes a visible article and returns the incremented count", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        visibility: "public",
        likes: [],
        articleTrips: [],
      });
      mockDbInsert.mockReturnValue({
        values: vi
          .fn()
          .mockReturnValue({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }),
      });
      // Post-write count() re-query returns the authoritative total.
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ value: 1 }]) }),
      });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}/like`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ liked: true, likeCount: 1 });
    });

    it("returns 404 when the article is not visible", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        visibility: "private",
        likes: [],
        articleTrips: [],
      });
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);
      mockDbQuery.friends.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}/like`, { method: "POST" });
      expect(res.status).toBe(404);
    });

    // Issue 5: guests must not be able to like
    it("returns 403 when a guest account tries to like", async () => {
      mockGetSession.mockResolvedValue({
        user: { ...fakeUser, isAnonymous: true },
        session: { id: "s" },
      });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}/like`, { method: "POST" });
      expect(res.status).toBe(403);
    });

    // Issue 6: invalid UUID must not reach Postgres
    it("returns 404 for a non-UUID articleId on POST like", async () => {
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/not-a-uuid/like", { method: "POST" });
      expect(res.status).toBe(404);
    });
  });

  // Issue 5: guest unlike
  describe("DELETE /api/articles/:articleId/like", () => {
    it("returns 403 when a guest account tries to unlike", async () => {
      mockGetSession.mockResolvedValue({
        user: { ...fakeUser, isAnonymous: true },
        session: { id: "s" },
      });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}/like`, { method: "DELETE" });
      expect(res.status).toBe(403);
    });

    it("unliking a visible article returns { liked: false, likeCount: 0 }", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        visibility: "public",
        likes: [],
        articleTrips: [],
      });
      mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ value: 0 }]) }),
      });

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}/like`, { method: "DELETE" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ liked: false, likeCount: 0 });
    });

    it("returns 404 when the article is not visible to the viewer", async () => {
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        visibility: "private",
        likes: [],
        articleTrips: [],
      });
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);
      mockDbQuery.friends.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}/like`, { method: "DELETE" });

      expect(res.status).toBe(404);
    });
  });

  // Issue 6: invalid UUID on other routes
  describe("invalid UUID parameter handling", () => {
    it("returns 404 for GET /:articleId with non-UUID (anonymous viewer)", async () => {
      mockGetSession.mockResolvedValue(null);

      // Use articleRoutes which now embeds the detail sub-router.
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/not-a-uuid");
      expect(res.status).toBe(404);
    });

    it("returns 404 for PATCH /:articleId with non-UUID", async () => {
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/not-a-uuid", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 404 for DELETE /:articleId with non-UUID", async () => {
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles/not-a-uuid", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  // Issue 1: routing integration — articleRoutes alone (no separate articleDetailRoutes mount)
  // must serve both the authenticated list and the public detail.
  describe("Article routing integration (double-mount regression)", () => {
    it("returns a public article to an anonymous viewer via articleRoutes", async () => {
      mockGetSession.mockResolvedValue(null);
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        title: "Public",
        content: "body",
        tags: [],
        visibility: "public",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        likes: [],
        articleTrips: [],
      });

      // Only mount articleRoutes — articleDetailRoutes must be embedded inside it.
      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.content).toBe("body");
    });

    it("returns 404 for a private article to an anonymous viewer", async () => {
      mockGetSession.mockResolvedValue(null);
      mockDbQuery.articles.findFirst.mockResolvedValue({
        id: articleId,
        ownerId: otherUserId,
        title: "Private",
        content: "secret",
        tags: [],
        visibility: "private",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        likes: [],
        articleTrips: [],
      });
      mockDbQuery.tripMembers.findFirst.mockResolvedValue(undefined);
      mockDbQuery.friends.findFirst.mockResolvedValue(undefined);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request(`/api/articles/${articleId}`);
      expect(res.status).toBe(404);
    });

    it("returns 401 for the article list to an anonymous viewer", async () => {
      mockGetSession.mockResolvedValue(null);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles");
      expect(res.status).toBe(401);
    });

    it("returns 200 for the article list to an authenticated user", async () => {
      mockDbQuery.articles.findMany.mockResolvedValue([]);

      const app = createTestApp(articleRoutes, "/api/articles");
      const res = await app.request("/api/articles");
      expect(res.status).toBe(200);
    });
  });
});
