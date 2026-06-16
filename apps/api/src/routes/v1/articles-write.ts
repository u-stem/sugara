// v1 write routes for articles.
//
// File layout:
//   POST   /articles
//   PATCH  /articles/:id
//   DELETE /articles/:articleId

import { MAX_ARTICLES_PER_USER } from "@sugara/shared";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { db } from "../../db";
import { articles, articleTrips } from "../../db/schema";
import { ApiV1Error, getApiKey, type V1Env } from "../../lib/external-api/errors";
import { getNextSortOrder } from "../../lib/sort-order";
import { requireApiKey } from "../../middleware/require-api-key";
import { errorResponseSchema } from "./openapi-schemas";
import { serializeArticleDto } from "./serializers";
import { uuidSchema } from "./shared";
import {
  v1ArticleWriteResponseSchema,
  v1CreateArticleSchema,
  v1DeleteResponseSchema,
  v1UpdateArticleSchema,
} from "./write-schemas";

export const articlesWriteApp = new Hono<V1Env>();

// ---------------------------------------------------------------------------
// POST /articles
// ---------------------------------------------------------------------------

articlesWriteApp.post(
  "/articles",
  describeRoute({
    tags: ["Articles"],
    summary: "Create an article",
    description:
      "Creates an article owned by the API key owner. Returns 409 when the per-user article limit is reached. Requires `articles:write` scope.",
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
        description: "Article created",
        content: {
          "application/json": { schema: resolver(v1ArticleWriteResponseSchema) },
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
        description:
          'Article limit reached (error.reason: "article_limit_reached", error.details.max)',
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("articles:write"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const body = await c.req.json();
    const parsed = v1CreateArticleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid request body");
    }

    const article = await db.transaction(async (tx) => {
      const [{ articleCount }] = await tx
        .select({ articleCount: count() })
        .from(articles)
        .where(eq(articles.ownerId, userId));

      if (articleCount >= MAX_ARTICLES_PER_USER) {
        return null;
      }

      // MAX+1, not COUNT: deleting a non-last article leaves a gap, and a
      // COUNT-based value would collide with an existing sortOrder (#137).
      const sortOrder = await getNextSortOrder(
        tx,
        articles.sortOrder,
        articles,
        eq(articles.ownerId, userId),
        `article:user:${userId}`,
      );

      const [created] = await tx
        .insert(articles)
        .values({
          ownerId: userId,
          title: parsed.data.title,
          content: parsed.data.content,
          tags: parsed.data.tags,
          visibility: parsed.data.visibility,
          sortOrder,
        })
        .returning();

      return created;
    });

    if (!article) {
      throw new ApiV1Error(409, "conflict", "Article limit reached for this account", {
        reason: "article_limit_reached",
        details: { max: MAX_ARTICLES_PER_USER },
      });
    }

    return c.json(serializeArticleDto(article, []), 201);
  },
);

// ---------------------------------------------------------------------------
// PATCH /articles/:id
// ---------------------------------------------------------------------------

articlesWriteApp.patch(
  "/articles/:id",
  describeRoute({
    tags: ["Articles"],
    summary: "Update an article",
    description:
      "Partially updates an article owned by the API key owner. Returns 404 for articles owned by other users (existence concealment — prevents id enumeration). Requires `articles:write` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        description: "Article UUID.",
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
        description: "Article updated",
        content: {
          "application/json": { schema: resolver(v1ArticleWriteResponseSchema) },
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
        description: "Article not found or owned by another user",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("articles:write"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const rawId = c.req.param("id");
    const parsedId = uuidSchema.safeParse(rawId);
    if (!parsedId.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid article id");
    }
    const articleId = parsedId.data;

    const body = await c.req.json();
    const parsed = v1UpdateArticleSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid request body");
    }

    // Existence concealment: 404 whether the article doesn't exist or belongs
    // to another user, preventing id enumeration via status-code differences.
    const existing = await db.query.articles.findFirst({
      where: eq(articles.id, articleId),
      with: { articleTrips: { columns: { tripId: true } } },
    });
    if (!existing || existing.ownerId !== userId) {
      throw new ApiV1Error(404, "not_found", "Article not found or access denied");
    }

    const [updated] = await db
      .update(articles)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(articles.id, articleId))
      .returning();

    // Re-fetch current trip links for the response DTO (update does not change them).
    const tripLinks = await db.query.articleTrips.findMany({
      where: eq(articleTrips.articleId, articleId),
      columns: { tripId: true },
    });

    return c.json(
      serializeArticleDto(
        updated,
        tripLinks.map((t) => t.tripId),
      ),
    );
  },
);

// ---------------------------------------------------------------------------
// DELETE /articles/:articleId
// ---------------------------------------------------------------------------

articlesWriteApp.delete(
  "/articles/:articleId",
  describeRoute({
    tags: ["Articles"],
    summary: "Delete an article",
    description:
      "Physically deletes an article owned by the API key owner. " +
      "Idempotent: returns 200 in all cases. " +
      "deleted:true when the article was found and removed; deleted:false when the id is unknown or " +
      "owned by another user (existence concealment — prevents id enumeration). " +
      "Associated article trips and likes are cascade-deleted. " +
      "remaining reflects the caller's post-operation article count. " +
      "Requires `articles:write` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "articleId",
        in: "path",
        required: true,
        description: "Article UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      200: {
        description:
          "Deletion result (deleted:true when removed, deleted:false when already gone or owned by another user)",
        content: { "application/json": { schema: resolver(v1DeleteResponseSchema) } },
      },
      400: {
        description: "Invalid article id",
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
    },
  }),
  requireApiKey("articles:write"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const rawId = c.req.param("articleId");
    const parsedId = uuidSchema.safeParse(rawId);
    if (!parsedId.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid article id");
    }
    const articleId = parsedId.data;

    // Atomic delete: ownerId guard is folded into the WHERE clause so another
    // user's article is never deleted and its existence is not revealed —
    // deleted:false is returned either way (existence concealment mirrors the
    // internal DELETE /articles/:articleId route). articleTrips and
    // articleLikes are cascade-deleted via FK onDelete constraints.
    const deletedRows = await db
      .delete(articles)
      .where(and(eq(articles.id, articleId), eq(articles.ownerId, userId)))
      .returning({ id: articles.id });
    const didDelete = deletedRows.length > 0;

    const [{ articleCount }] = await db
      .select({ articleCount: count() })
      .from(articles)
      .where(eq(articles.ownerId, userId));

    return c.json({
      id: articleId,
      deleted: didDelete,
      remaining: { count: articleCount, max: MAX_ARTICLES_PER_USER },
    });
  },
);
