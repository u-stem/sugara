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
      expect(body.tripIds).toBeUndefined(); // not the owner
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
  });
});
