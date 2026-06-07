import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp } from "./test-helpers";

const { mockDbQuery, mockAuth } = vi.hoisted(() => ({
  mockDbQuery: {
    users: { findFirst: vi.fn() },
    bookmarkLists: { findMany: vi.fn(), findFirst: vi.fn() },
    articles: { findMany: vi.fn() },
    friends: { findFirst: vi.fn() },
  },
  mockAuth: {
    api: { getSession: vi.fn() },
  },
}));

vi.mock("../db/index", () => ({
  db: { query: mockDbQuery },
}));

vi.mock("../lib/auth", () => ({
  auth: mockAuth,
}));

import { profileRoutes } from "../routes/profile";

const ownerId = "00000000-0000-0000-0000-000000000001";
const viewerId = "00000000-0000-0000-0000-000000000002";
const listId = "00000000-0000-0000-0000-000000000010";

function requestWithSession(url: string, userId: string) {
  mockAuth.api.getSession.mockResolvedValue({
    user: { id: userId },
    session: { id: "session-1" },
  });
  return app.request(url);
}

let app: ReturnType<typeof createTestApp>;

describe("Profile routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.api.getSession.mockResolvedValue(null);
    app = createTestApp(profileRoutes, "/api/users");
  });

  // --- GET /api/users/:userId/articles ---
  describe("GET /api/users/:userId/articles", () => {
    function makeArticle(id: string, visibility: "private" | "friends_only" | "public") {
      return {
        id,
        ownerId,
        title: `Article ${id}`,
        tags: [],
        visibility,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        likes: [],
      };
    }

    it("returns all articles (private, friends_only, public) to the owner", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({ id: ownerId, name: "Alice", image: null });
      mockDbQuery.articles.findMany.mockResolvedValue([
        makeArticle("a1", "private"),
        makeArticle("a2", "friends_only"),
        makeArticle("a3", "public"),
      ]);

      const res = await requestWithSession(`/api/users/${ownerId}/articles`, ownerId);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.articles).toHaveLength(3);
    });

    it("returns friends_only and public articles to a friend", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({ id: ownerId, name: "Alice", image: null });
      mockDbQuery.friends.findFirst.mockResolvedValue({ id: "friend-1" });
      mockDbQuery.articles.findMany.mockResolvedValue([
        makeArticle("a2", "friends_only"),
        makeArticle("a3", "public"),
      ]);

      const res = await requestWithSession(`/api/users/${ownerId}/articles`, viewerId);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.articles).toHaveLength(2);
    });

    it("returns only public articles to a non-friend authenticated user", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({ id: ownerId, name: "Alice", image: null });
      mockDbQuery.friends.findFirst.mockResolvedValue(undefined);
      mockDbQuery.articles.findMany.mockResolvedValue([makeArticle("a3", "public")]);

      const res = await requestWithSession(`/api/users/${ownerId}/articles`, viewerId);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.articles).toHaveLength(1);
    });

    it("returns 404 for a non-UUID userId", async () => {
      const res = await app.request("/api/users/not-a-uuid/articles");

      expect(res.status).toBe(404);
    });
  });

  // --- GET /api/users/:userId/bookmark-lists ---
  describe("GET /api/users/:userId/bookmark-lists", () => {
    it("returns only public lists for unauthenticated visitor", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: ownerId,
        name: "Alice",
        image: null,
      });
      mockDbQuery.bookmarkLists.findMany.mockResolvedValue([
        {
          id: listId,
          name: "Tokyo",
          visibility: "public",
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          bookmarks: [{ id: "b1" }, { id: "b2" }],
        },
      ]);

      const res = await app.request(`/api/users/${ownerId}/bookmark-lists`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.name).toBe("Alice");
      expect(body.bookmarkLists).toHaveLength(1);
      expect(body.bookmarkLists[0].bookmarkCount).toBe(2);
    });

    it("returns empty lists when user has no public lists", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: ownerId,
        name: "Alice",
        image: null,
      });
      mockDbQuery.bookmarkLists.findMany.mockResolvedValue([]);

      const res = await app.request(`/api/users/${ownerId}/bookmark-lists`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.bookmarkLists).toEqual([]);
    });

    it("returns 404 when user not found", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue(undefined);

      const res = await app.request(`/api/users/${ownerId}/bookmark-lists`);

      expect(res.status).toBe(404);
    });

    it("returns all lists when viewer is the owner", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: ownerId,
        name: "Alice",
        image: null,
      });
      mockDbQuery.bookmarkLists.findMany.mockResolvedValue([
        {
          id: "list-1",
          name: "Private",
          visibility: "private",
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          bookmarks: [],
        },
        {
          id: "list-2",
          name: "Friends",
          visibility: "friends_only",
          sortOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          bookmarks: [],
        },
        {
          id: "list-3",
          name: "Public",
          visibility: "public",
          sortOrder: 2,
          createdAt: new Date(),
          updatedAt: new Date(),
          bookmarks: [],
        },
      ]);

      const res = await requestWithSession(`/api/users/${ownerId}/bookmark-lists`, ownerId);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.bookmarkLists).toHaveLength(3);
    });

    it("returns public + friends_only lists for a friend", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: ownerId,
        name: "Alice",
        image: null,
      });
      mockDbQuery.friends.findFirst.mockResolvedValue({ id: "friend-1" });
      mockDbQuery.bookmarkLists.findMany.mockResolvedValue([
        {
          id: "list-1",
          name: "Friends",
          visibility: "friends_only",
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          bookmarks: [],
        },
        {
          id: "list-2",
          name: "Public",
          visibility: "public",
          sortOrder: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          bookmarks: [],
        },
      ]);

      const res = await requestWithSession(`/api/users/${ownerId}/bookmark-lists`, viewerId);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.bookmarkLists).toHaveLength(2);
    });

    it("returns only public lists for a non-friend authenticated user", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: ownerId,
        name: "Alice",
        image: null,
      });
      mockDbQuery.friends.findFirst.mockResolvedValue(undefined);
      mockDbQuery.bookmarkLists.findMany.mockResolvedValue([
        {
          id: "list-1",
          name: "Public",
          visibility: "public",
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          bookmarks: [],
        },
      ]);

      const res = await requestWithSession(`/api/users/${ownerId}/bookmark-lists`, viewerId);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.bookmarkLists).toHaveLength(1);
    });
  });

  // --- GET /api/users/:userId/profile ---
  describe("GET /api/users/:userId/profile", () => {
    it("returns profile for authenticated user", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: ownerId,
        name: "Alice",
        image: null,
      });

      const res = await requestWithSession(`/api/users/${ownerId}/profile`, viewerId);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ id: ownerId, name: "Alice", image: null });
    });

    it("returns 401 for unauthenticated request", async () => {
      const res = await app.request(`/api/users/${ownerId}/profile`);

      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent user", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue(undefined);

      const res = await requestWithSession(`/api/users/${ownerId}/profile`, viewerId);

      expect(res.status).toBe(404);
    });

    it("does not include email in response", async () => {
      mockDbQuery.users.findFirst.mockResolvedValue({
        id: ownerId,
        name: "Alice",
        image: null,
      });

      const res = await requestWithSession(`/api/users/${ownerId}/profile`, viewerId);
      const body = await res.json();

      expect(body).not.toHaveProperty("email");
    });
  });

  // --- GET /api/users/:userId/bookmark-lists/:listId ---
  describe("GET /api/users/:userId/bookmark-lists/:listId", () => {
    it("returns public list with bookmarks", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
        id: listId,
        userId: ownerId,
        name: "Tokyo",
        visibility: "public",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        bookmarks: [
          {
            id: "b1",
            name: "Cafe A",
            memo: null,
            url: null,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const res = await app.request(`/api/users/${ownerId}/bookmark-lists/${listId}`);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.name).toBe("Tokyo");
      expect(body.bookmarks).toHaveLength(1);
    });

    it("returns 404 for private list when unauthenticated", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
        id: listId,
        userId: ownerId,
        visibility: "private",
        bookmarks: [],
      });

      const res = await app.request(`/api/users/${ownerId}/bookmark-lists/${listId}`);

      expect(res.status).toBe(404);
    });

    it("returns 404 when list not found", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue(undefined);

      const res = await app.request(`/api/users/${ownerId}/bookmark-lists/${listId}`);

      expect(res.status).toBe(404);
    });

    it("allows owner to view their own private list", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
        id: listId,
        userId: ownerId,
        name: "Secret",
        visibility: "private",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        bookmarks: [],
      });

      const res = await requestWithSession(
        `/api/users/${ownerId}/bookmark-lists/${listId}`,
        ownerId,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.name).toBe("Secret");
    });

    it("allows friend to view friends_only list", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
        id: listId,
        userId: ownerId,
        name: "Friends List",
        visibility: "friends_only",
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        bookmarks: [],
      });
      mockDbQuery.friends.findFirst.mockResolvedValue({ id: "friend-1" });

      const res = await requestWithSession(
        `/api/users/${ownerId}/bookmark-lists/${listId}`,
        viewerId,
      );
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.name).toBe("Friends List");
    });

    it("returns 404 for friends_only list when not a friend", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
        id: listId,
        userId: ownerId,
        visibility: "friends_only",
        bookmarks: [],
      });
      mockDbQuery.friends.findFirst.mockResolvedValue(undefined);

      const res = await requestWithSession(
        `/api/users/${ownerId}/bookmark-lists/${listId}`,
        viewerId,
      );

      expect(res.status).toBe(404);
    });

    it("returns 404 for friends_only list when unauthenticated", async () => {
      mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
        id: listId,
        userId: ownerId,
        visibility: "friends_only",
        bookmarks: [],
      });

      const res = await app.request(`/api/users/${ownerId}/bookmark-lists/${listId}`);

      expect(res.status).toBe(404);
    });
  });
});
