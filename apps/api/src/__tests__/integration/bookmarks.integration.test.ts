// Integration tests for bookmark routes against a real PostgreSQL database.
// Focus: sortOrder assignment must survive deletions (#143) — COUNT-based
// numbering collides with existing rows after a non-last bookmark is removed.

import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();

vi.mock("../../db/index", async () => {
  const { getTestDb } = await import("./setup");
  return { db: getTestDb() };
});

vi.mock("../../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

import { bookmarkLists } from "../../db/schema";
import { bookmarkRoutes } from "../../routes/bookmarks";
import { cleanupTables, createTestUser, getTestDb, teardownTestDb } from "./setup";

function createApp() {
  const app = new Hono();
  app.route("/api/bookmark-lists", bookmarkRoutes);
  return app;
}

function json(body: unknown) {
  return {
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("Bookmarks Integration", () => {
  const app = createApp();
  let owner: { id: string; name: string; email: string };
  let listId: string;

  beforeEach(async () => {
    await cleanupTables();
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: owner,
      session: { id: "test-session" },
    }));
    const [list] = await getTestDb()
      .insert(bookmarkLists)
      .values({ userId: owner.id, name: "My List" })
      .returning();
    listId = list.id;
  });

  afterAll(async () => {
    await cleanupTables();
    await teardownTestDb();
  });

  async function createBookmark(name: string) {
    const res = await app.request(
      `/api/bookmark-lists/${listId}/bookmarks`,
      json({ name, urls: [] }),
    );
    expect(res.status).toBe(201);
    return res.json();
  }

  it("assigns a non-colliding sortOrder to a bookmark created after deleting a middle bookmark", async () => {
    // Arrange: bookmarks A/B/C get sortOrder 0/1/2; deleting B leaves a gap
    await createBookmark("A");
    const b = await createBookmark("B");
    await createBookmark("C");
    await app.request(`/api/bookmark-lists/${listId}/bookmarks/${b.id}`, { method: "DELETE" });

    // Act
    const d = await createBookmark("D");

    // Assert: MAX+1, not COUNT (COUNT=2 would collide with C's sortOrder)
    expect(d.sortOrder).toBe(3);
  });
});
