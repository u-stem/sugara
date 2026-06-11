// v1 write routes for bookmark lists and bookmarks.
//
// File layout:
//   POST   /bookmark-lists
//   PATCH  /bookmark-lists/:listId
//   POST   /bookmark-lists/:listId/bookmarks
//   PATCH  /bookmark-lists/:listId/bookmarks/:bookmarkId

import { MAX_BOOKMARK_LISTS_PER_USER, MAX_BOOKMARKS_PER_LIST } from "@sugara/shared";
import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { db } from "../../db";
import { bookmarkLists, bookmarks } from "../../db/schema";
import { verifyListOwnership } from "../../lib/bookmark-ownership";
import { ApiV1Error, getApiKey, type V1Env } from "../../lib/external-api/errors";
import { getNextSortOrder } from "../../lib/sort-order";
import { requireApiKey } from "../../middleware/require-api-key";
import { errorResponseSchema } from "./openapi-schemas";
import { serializeBookmarkDto, serializeListDto } from "./serializers";
import { uuidSchema } from "./shared";
import {
  v1BookmarkListWriteResponseSchema,
  v1BookmarkWriteResponseSchema,
  v1CreateBookmarkListSchema,
  v1CreateBookmarkSchema,
  v1UpdateBookmarkListSchema,
  v1UpdateBookmarkSchema,
} from "./write-schemas";

export const bookmarksWriteApp = new Hono<V1Env>();

// ---------------------------------------------------------------------------
// POST /bookmark-lists
// ---------------------------------------------------------------------------

bookmarksWriteApp.post(
  "/bookmark-lists",
  describeRoute({
    tags: ["Bookmarks"],
    summary: "Create a bookmark list",
    description:
      "Creates a bookmark list owned by the API key owner. Returns 409 when the per-user list limit is reached. Requires `bookmarks:write` scope.",
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    },
    responses: {
      201: {
        description: "Bookmark list created",
        content: {
          "application/json": { schema: resolver(v1BookmarkListWriteResponseSchema) },
        },
      },
      400: {
        description: "Invalid request body",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      403: {
        description: "Insufficient scope",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      409: {
        description: "Bookmark list limit reached",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("bookmarks:write"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const body = await c.req.json();
    const parsed = v1CreateBookmarkListSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid request body");
    }

    const list = await db.transaction(async (tx) => {
      const [{ listCount }] = await tx
        .select({ listCount: count() })
        .from(bookmarkLists)
        .where(eq(bookmarkLists.userId, userId));

      if (listCount >= MAX_BOOKMARK_LISTS_PER_USER) {
        return null;
      }

      const nextOrder = await getNextSortOrder(
        tx,
        bookmarkLists.sortOrder,
        bookmarkLists,
        eq(bookmarkLists.userId, userId),
      );

      const [created] = await tx
        .insert(bookmarkLists)
        .values({
          userId,
          name: parsed.data.name,
          visibility: parsed.data.visibility,
          sortOrder: nextOrder,
        })
        .returning();

      return created;
    });

    if (!list) {
      throw new ApiV1Error(409, "conflict", "Bookmark list limit reached for this account");
    }

    return c.json(serializeListDto(list, 0), 201);
  },
);

// ---------------------------------------------------------------------------
// PATCH /bookmark-lists/:listId
// ---------------------------------------------------------------------------

bookmarksWriteApp.patch(
  "/bookmark-lists/:listId",
  describeRoute({
    tags: ["Bookmarks"],
    summary: "Update a bookmark list",
    description:
      "Partially updates a bookmark list owned by the API key owner. Returns 404 for lists owned by other users (existence concealment). Requires `bookmarks:write` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "listId",
        in: "path",
        required: true,
        description: "Bookmark list UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    },
    responses: {
      200: {
        description: "Bookmark list updated",
        content: {
          "application/json": { schema: resolver(v1BookmarkListWriteResponseSchema) },
        },
      },
      400: {
        description: "Invalid request body",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      403: {
        description: "Insufficient scope",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      404: {
        description: "Bookmark list not found or not owned by caller",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("bookmarks:write"),
  async (c) => {
    const key = getApiKey(c);

    const rawListId = c.req.param("listId");
    const parsedId = uuidSchema.safeParse(rawListId);
    if (!parsedId.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid list id");
    }
    const listId = parsedId.data;

    const list = await verifyListOwnership(listId, key.userId);
    if (!list) {
      throw new ApiV1Error(404, "not_found", "Bookmark list not found or access denied");
    }

    const body = await c.req.json();
    const parsed = v1UpdateBookmarkListSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid request body");
    }

    const [updated] = await db
      .update(bookmarkLists)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(bookmarkLists.id, listId))
      .returning();

    // Count bookmarks for the response DTO.
    const [{ bCount }] = await db
      .select({ bCount: count() })
      .from(bookmarks)
      .where(eq(bookmarks.listId, listId));

    return c.json(serializeListDto(updated, bCount));
  },
);

// ---------------------------------------------------------------------------
// POST /bookmark-lists/:listId/bookmarks
// ---------------------------------------------------------------------------

bookmarksWriteApp.post(
  "/bookmark-lists/:listId/bookmarks",
  describeRoute({
    tags: ["Bookmarks"],
    summary: "Add a bookmark",
    description:
      "Appends a bookmark to a list owned by the API key owner. Returns 409 when the per-list bookmark limit is reached. Requires `bookmarks:write` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "listId",
        in: "path",
        required: true,
        description: "Bookmark list UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    },
    responses: {
      201: {
        description: "Bookmark created",
        content: {
          "application/json": { schema: resolver(v1BookmarkWriteResponseSchema) },
        },
      },
      400: {
        description: "Invalid request body",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      403: {
        description: "Insufficient scope",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      404: {
        description: "Bookmark list not found or not owned by caller",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      409: {
        description: "Bookmark limit reached for this list",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("bookmarks:write"),
  async (c) => {
    const key = getApiKey(c);

    const rawListId = c.req.param("listId");
    const parsedId = uuidSchema.safeParse(rawListId);
    if (!parsedId.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid list id");
    }
    const listId = parsedId.data;

    const list = await verifyListOwnership(listId, key.userId);
    if (!list) {
      throw new ApiV1Error(404, "not_found", "Bookmark list not found or access denied");
    }

    const body = await c.req.json();
    const parsed = v1CreateBookmarkSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid request body");
    }

    const bookmark = await db.transaction(async (tx) => {
      const [{ bCount }] = await tx
        .select({ bCount: count() })
        .from(bookmarks)
        .where(eq(bookmarks.listId, listId));

      if (bCount >= MAX_BOOKMARKS_PER_LIST) {
        return null;
      }

      const nextOrder = await getNextSortOrder(
        tx,
        bookmarks.sortOrder,
        bookmarks,
        eq(bookmarks.listId, listId),
      );

      const [created] = await tx
        .insert(bookmarks)
        .values({
          listId,
          name: parsed.data.name,
          memo: parsed.data.memo ?? null,
          urls: parsed.data.urls,
          sortOrder: nextOrder,
        })
        .returning();

      return created;
    });

    if (!bookmark) {
      throw new ApiV1Error(409, "conflict", "Bookmark limit reached for this list");
    }

    return c.json(serializeBookmarkDto(bookmark), 201);
  },
);

// ---------------------------------------------------------------------------
// PATCH /bookmark-lists/:listId/bookmarks/:bookmarkId
// ---------------------------------------------------------------------------

bookmarksWriteApp.patch(
  "/bookmark-lists/:listId/bookmarks/:bookmarkId",
  describeRoute({
    tags: ["Bookmarks"],
    summary: "Update a bookmark",
    description:
      "Partially updates a bookmark within a list owned by the API key owner. Returns 404 when the bookmark does not belong to the list (existence concealment). Requires `bookmarks:write` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "listId",
        in: "path",
        required: true,
        description: "Bookmark list UUID.",
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "bookmarkId",
        in: "path",
        required: true,
        description: "Bookmark UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { type: "object" },
        },
      },
    },
    responses: {
      200: {
        description: "Bookmark updated",
        content: {
          "application/json": { schema: resolver(v1BookmarkWriteResponseSchema) },
        },
      },
      400: {
        description: "Invalid request body",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      401: {
        description: "Missing or invalid API key",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      403: {
        description: "Insufficient scope",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
      404: {
        description: "List not found, not owned, or bookmark not in list",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("bookmarks:write"),
  async (c) => {
    const key = getApiKey(c);

    const rawListId = c.req.param("listId");
    const parsedListId = uuidSchema.safeParse(rawListId);
    if (!parsedListId.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid list id");
    }
    const listId = parsedListId.data;

    const rawBookmarkId = c.req.param("bookmarkId");
    const parsedBookmarkId = uuidSchema.safeParse(rawBookmarkId);
    if (!parsedBookmarkId.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid bookmark id");
    }
    const bookmarkId = parsedBookmarkId.data;

    // Ownership check first: 404 whether the list doesn't exist or belongs to
    // another user (existence concealment).
    const list = await verifyListOwnership(listId, key.userId);
    if (!list) {
      throw new ApiV1Error(404, "not_found", "Bookmark list not found or access denied");
    }

    // Verify the bookmark belongs to this list.
    const existing = await db.query.bookmarks.findFirst({
      where: eq(bookmarks.id, bookmarkId),
    });
    if (!existing || existing.listId !== listId) {
      throw new ApiV1Error(404, "not_found", "Bookmark not found in this list");
    }

    const body = await c.req.json();
    const parsed = v1UpdateBookmarkSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid request body");
    }

    const [updated] = await db
      .update(bookmarks)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(bookmarks.id, bookmarkId))
      .returning();

    return c.json(serializeBookmarkDto(updated));
  },
);
