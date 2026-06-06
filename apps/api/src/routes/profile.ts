import type { ArticleVisibility, BookmarkListVisibility } from "@sugara/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { articles, bookmarkLists, users } from "../db/schema";
import { ERROR_MSG } from "../lib/constants";
import { areFriends } from "../lib/friends";
import { getParam } from "../lib/params";
import { optionalAuth } from "../middleware/optional-auth";
import type { OptionalAuthEnv } from "../types";

const profileRoutes = new Hono<OptionalAuthEnv>();

// Public profile: list bookmark lists filtered by relationship
profileRoutes.get("/:userId/bookmark-lists", optionalAuth, async (c) => {
  const userId = getParam(c, "userId");

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, name: true, image: true },
  });
  if (!user) {
    return c.json({ error: ERROR_MSG.USER_NOT_FOUND }, 404);
  }

  const viewerId = c.get("user")?.id;

  let visibilityFilter: BookmarkListVisibility[];
  if (viewerId === userId) {
    visibilityFilter = ["private", "friends_only", "public"];
  } else if (viewerId && (await areFriends(viewerId, userId))) {
    visibilityFilter = ["friends_only", "public"];
  } else {
    visibilityFilter = ["public"];
  }

  const lists = await db.query.bookmarkLists.findMany({
    where: and(
      eq(bookmarkLists.userId, userId),
      inArray(bookmarkLists.visibility, visibilityFilter),
    ),
    orderBy: bookmarkLists.sortOrder,
    with: { bookmarks: { columns: { id: true } } },
  });

  return c.json({
    id: user.id,
    name: user.name,
    image: user.image,
    bookmarkLists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      visibility: l.visibility,
      sortOrder: l.sortOrder,
      bookmarkCount: l.bookmarks.length,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    })),
  });
});

// Public profile: list articles filtered by relationship. Unlike the article
// detail route, this surfaces only profile-level visibility (no context sharing).
profileRoutes.get("/:userId/articles", optionalAuth, async (c) => {
  const userId = getParam(c, "userId");

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, name: true, image: true },
  });
  if (!user) {
    return c.json({ error: ERROR_MSG.USER_NOT_FOUND }, 404);
  }

  const viewerId = c.get("user")?.id;

  let visibilityFilter: ArticleVisibility[];
  if (viewerId === userId) {
    visibilityFilter = ["private", "friends_only", "public"];
  } else if (viewerId && (await areFriends(viewerId, userId))) {
    visibilityFilter = ["friends_only", "public"];
  } else {
    visibilityFilter = ["public"];
  }

  const rows = await db.query.articles.findMany({
    where: and(eq(articles.ownerId, userId), inArray(articles.visibility, visibilityFilter)),
    orderBy: articles.sortOrder,
    with: { likes: { columns: { userId: true } } },
  });

  return c.json({
    id: user.id,
    name: user.name,
    image: user.image,
    articles: rows.map((a) => ({
      id: a.id,
      title: a.title,
      tags: a.tags,
      visibility: a.visibility,
      sortOrder: a.sortOrder,
      likeCount: a.likes.length,
      likedByViewer: viewerId ? a.likes.some((l) => l.userId === viewerId) : false,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
  });
});

// Minimal public profile for friend request confirmation
profileRoutes.get("/:userId/profile", optionalAuth, async (c) => {
  const viewer = c.get("user");
  if (!viewer) return c.json({ error: ERROR_MSG.UNAUTHORIZED }, 401);

  const userId = getParam(c, "userId");

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, name: true, image: true },
  });

  if (!user) return c.json({ error: ERROR_MSG.USER_NOT_FOUND }, 404);

  return c.json({ id: user.id, name: user.name, image: user.image });
});

// Public: single list with bookmarks (access check by visibility)
profileRoutes.get("/:userId/bookmark-lists/:listId", optionalAuth, async (c) => {
  const userId = getParam(c, "userId");
  const listId = getParam(c, "listId");

  const list = await db.query.bookmarkLists.findFirst({
    where: eq(bookmarkLists.id, listId),
    with: { bookmarks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
  });

  if (!list || list.userId !== userId) {
    return c.json({ error: ERROR_MSG.BOOKMARK_LIST_NOT_FOUND }, 404);
  }

  const viewerId = c.get("user")?.id;

  if (list.visibility === "private" && viewerId !== userId) {
    return c.json({ error: ERROR_MSG.BOOKMARK_LIST_NOT_FOUND }, 404);
  }

  if (list.visibility === "friends_only" && viewerId !== userId) {
    if (!viewerId || !(await areFriends(viewerId, userId))) {
      return c.json({ error: ERROR_MSG.BOOKMARK_LIST_NOT_FOUND }, 404);
    }
  }

  return c.json({
    id: list.id,
    name: list.name,
    visibility: list.visibility,
    sortOrder: list.sortOrder,
    bookmarkCount: list.bookmarks.length,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
    bookmarks: list.bookmarks,
  });
});

export { profileRoutes };
