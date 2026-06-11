import {
  batchBookmarkListIdsSchema,
  createBookmarkListSchema,
  MAX_BOOKMARK_LISTS_PER_USER,
  reorderBookmarkListsSchema,
  updateBookmarkListSchema,
} from "@sugara/shared";
import { and, count, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { bookmarkLists, bookmarks } from "../db/schema";
import { ERROR_MSG } from "../lib/constants";
import { hasChanges } from "../lib/has-changes";
import { getParam } from "../lib/params";
import { getNextSortOrder } from "../lib/sort-order";
import { requireAuth } from "../middleware/auth";
import { requireNonGuest } from "../middleware/require-non-guest";
import type { AppEnv } from "../types";

const bookmarkListRoutes = new Hono<AppEnv>();
bookmarkListRoutes.use("*", requireAuth);
bookmarkListRoutes.use("*", requireNonGuest);

// List own bookmark lists
bookmarkListRoutes.get("/", async (c) => {
  const user = c.get("user");

  const lists = await db.query.bookmarkLists.findMany({
    where: eq(bookmarkLists.userId, user.id),
    orderBy: bookmarkLists.sortOrder,
    with: { bookmarks: { columns: { id: true } } },
  });

  return c.json(
    lists.map((l) => ({
      id: l.id,
      name: l.name,
      visibility: l.visibility,
      sortOrder: l.sortOrder,
      bookmarkCount: l.bookmarks.length,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    })),
  );
});

// Create bookmark list
bookmarkListRoutes.post("/", async (c) => {
  const user = c.get("user");

  const body = await c.req.json();
  const parsed = createBookmarkListSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const created = await db.transaction(async (tx) => {
    const [{ count: listCount }] = await tx
      .select({ count: count() })
      .from(bookmarkLists)
      .where(eq(bookmarkLists.userId, user.id));

    if (listCount >= MAX_BOOKMARK_LISTS_PER_USER) {
      return null;
    }

    // MAX+1, not COUNT: deleting a non-last list leaves a gap, and a
    // COUNT-based value would collide with an existing sortOrder (#143).
    const sortOrder = await getNextSortOrder(
      tx,
      bookmarkLists.sortOrder,
      bookmarkLists,
      eq(bookmarkLists.userId, user.id),
    );

    const [result] = await tx
      .insert(bookmarkLists)
      .values({
        userId: user.id,
        name: parsed.data.name,
        visibility: parsed.data.visibility,
        sortOrder,
      })
      .returning();

    return result;
  });

  if (!created) {
    return c.json({ error: ERROR_MSG.LIMIT_BOOKMARK_LISTS }, 409);
  }

  return c.json(created, 201);
});

// Reorder bookmark lists
bookmarkListRoutes.patch("/reorder", async (c) => {
  const user = c.get("user");

  const body = await c.req.json();
  const parsed = reorderBookmarkListsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const lists = await db.query.bookmarkLists.findMany({
    where: eq(bookmarkLists.userId, user.id),
    columns: { id: true },
  });
  const ownIds = new Set(lists.map((l) => l.id));
  const allOwned = parsed.data.orderedIds.every((id) => ownIds.has(id));
  if (!allOwned) {
    return c.json({ error: ERROR_MSG.BOOKMARK_LIST_NOT_FOUND }, 400);
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.orderedIds.length; i++) {
      await tx
        .update(bookmarkLists)
        .set({ sortOrder: i })
        .where(eq(bookmarkLists.id, parsed.data.orderedIds[i]));
    }
  });

  return c.json({ ok: true });
});

// Update bookmark list
bookmarkListRoutes.patch("/:listId", async (c) => {
  const user = c.get("user");
  const listId = getParam(c, "listId");

  const body = await c.req.json();
  const parsed = updateBookmarkListSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.bookmarkLists.findFirst({
    where: eq(bookmarkLists.id, listId),
  });
  if (!existing || existing.userId !== user.id) {
    return c.json({ error: ERROR_MSG.BOOKMARK_LIST_NOT_FOUND }, 404);
  }

  if (!hasChanges(existing, parsed.data)) {
    return c.json(existing);
  }

  const [updated] = await db
    .update(bookmarkLists)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(bookmarkLists.id, listId))
    .returning();

  return c.json(updated);
});

// Duplicate bookmark list with bookmarks
bookmarkListRoutes.post("/:listId/duplicate", async (c) => {
  const user = c.get("user");
  const listId = getParam(c, "listId");

  const source = await db.query.bookmarkLists.findFirst({
    where: eq(bookmarkLists.id, listId),
    with: { bookmarks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
  });

  if (!source || source.userId !== user.id) {
    return c.json({ error: ERROR_MSG.BOOKMARK_LIST_NOT_FOUND }, 404);
  }

  const created = await db.transaction(async (tx) => {
    const [{ count: listCount }] = await tx
      .select({ count: count() })
      .from(bookmarkLists)
      .where(eq(bookmarkLists.userId, user.id));

    if (listCount >= MAX_BOOKMARK_LISTS_PER_USER) {
      return null;
    }

    // MAX+1, not COUNT: see the create handler above (#143).
    const sortOrder = await getNextSortOrder(
      tx,
      bookmarkLists.sortOrder,
      bookmarkLists,
      eq(bookmarkLists.userId, user.id),
    );

    const [newList] = await tx
      .insert(bookmarkLists)
      .values({
        userId: user.id,
        name: `${source.name} (copy)`,
        visibility: source.visibility,
        sortOrder,
      })
      .returning();

    if (source.bookmarks.length > 0) {
      await tx.insert(bookmarks).values(
        source.bookmarks.map((bm, i) => ({
          listId: newList.id,
          name: bm.name,
          memo: bm.memo,
          urls: bm.urls,
          sortOrder: i,
        })),
      );
    }

    return newList;
  });

  if (!created) {
    return c.json({ error: ERROR_MSG.LIMIT_BOOKMARK_LISTS }, 409);
  }

  return c.json(created, 201);
});

// Batch delete bookmark lists
bookmarkListRoutes.post("/batch-delete", async (c) => {
  const user = c.get("user");

  const body = await c.req.json();
  const parsed = batchBookmarkListIdsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const found = await db.query.bookmarkLists.findMany({
    where: and(inArray(bookmarkLists.id, parsed.data.listIds), eq(bookmarkLists.userId, user.id)),
    columns: { id: true },
  });
  if (found.length !== parsed.data.listIds.length) {
    return c.json({ error: ERROR_MSG.BOOKMARK_LIST_NOT_FOUND }, 404);
  }

  await db.delete(bookmarkLists).where(inArray(bookmarkLists.id, parsed.data.listIds));

  return c.json({ ok: true });
});

// Batch duplicate bookmark lists
bookmarkListRoutes.post("/batch-duplicate", async (c) => {
  const user = c.get("user");

  const body = await c.req.json();
  const parsed = batchBookmarkListIdsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const sources = await db.query.bookmarkLists.findMany({
    where: and(inArray(bookmarkLists.id, parsed.data.listIds), eq(bookmarkLists.userId, user.id)),
    with: { bookmarks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
  });
  if (sources.length !== parsed.data.listIds.length) {
    return c.json({ error: ERROR_MSG.BOOKMARK_LIST_NOT_FOUND }, 404);
  }

  const result = await db.transaction(async (tx) => {
    const [{ count: listCount }] = await tx
      .select({ count: count() })
      .from(bookmarkLists)
      .where(eq(bookmarkLists.userId, user.id));

    if (listCount + sources.length > MAX_BOOKMARK_LISTS_PER_USER) {
      return null;
    }

    // MAX+1, not COUNT: see the create handler above (#143).
    const baseSortOrder = await getNextSortOrder(
      tx,
      bookmarkLists.sortOrder,
      bookmarkLists,
      eq(bookmarkLists.userId, user.id),
    );

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const [newList] = await tx
        .insert(bookmarkLists)
        .values({
          userId: user.id,
          name: `${source.name} (copy)`,
          visibility: source.visibility,
          sortOrder: baseSortOrder + i,
        })
        .returning();

      if (source.bookmarks.length > 0) {
        await tx.insert(bookmarks).values(
          source.bookmarks.map((bm, j) => ({
            listId: newList.id,
            name: bm.name,
            memo: bm.memo,
            urls: bm.urls,
            sortOrder: j,
          })),
        );
      }
    }

    return true;
  });

  if (!result) {
    return c.json({ error: ERROR_MSG.LIMIT_BOOKMARK_LISTS }, 409);
  }

  return c.json({ ok: true }, 201);
});

// Delete bookmark list (cascades bookmarks)
bookmarkListRoutes.delete("/:listId", async (c) => {
  const user = c.get("user");
  const listId = getParam(c, "listId");

  const existing = await db.query.bookmarkLists.findFirst({
    where: eq(bookmarkLists.id, listId),
  });
  if (!existing || existing.userId !== user.id) {
    return c.json({ error: ERROR_MSG.BOOKMARK_LIST_NOT_FOUND }, 404);
  }

  await db.delete(bookmarkLists).where(eq(bookmarkLists.id, listId));

  return c.json({ ok: true });
});

export { bookmarkListRoutes };
