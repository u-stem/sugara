import {
  batchArticleIdsSchema,
  createArticleSchema,
  MAX_ARTICLES_PER_USER,
  reorderArticlesSchema,
  setArticleTripsSchema,
  updateArticleSchema,
} from "@sugara/shared";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { articleLikes, articles, articleTrips, tripMembers } from "../db/schema";
import { ERROR_MSG } from "../lib/constants";
import { areFriends } from "../lib/friends";
import { hasChanges } from "../lib/has-changes";
import { getParam, isValidUuid } from "../lib/params";
import { getNextSortOrder } from "../lib/sort-order";
import { requireAuth } from "../middleware/auth";
import { optionalAuth } from "../middleware/optional-auth";
import { requireNonGuest } from "../middleware/require-non-guest";
import type { AppEnv, OptionalAuthEnv } from "../types";

// --- Serialization ------------------------------------------------------------

type LikeRow = { userId: string };

type ArticleWithLikes = {
  id: string;
  ownerId: string;
  title: string;
  content: string;
  tags: string[];
  visibility: "private" | "friends_only" | "public";
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  likes: LikeRow[];
};

// List/profile cards: omit the (potentially large) Markdown body. Shape matches
// ArticleListItem in @sugara/shared. Exported so profile routes serialize the
// same shape instead of duplicating the field mapping.
export function articleSummary(a: ArticleWithLikes, viewerId: string | undefined) {
  return {
    id: a.id,
    ownerId: a.ownerId,
    title: a.title,
    tags: a.tags,
    visibility: a.visibility,
    sortOrder: a.sortOrder,
    likeCount: a.likes.length,
    likedByMe: viewerId ? a.likes.some((l) => l.userId === viewerId) : false,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// Detail view: include the body. Shape matches ArticleResponse. tripIds are
// real only for the owner; others get [] so a context-share viewer can't
// enumerate the author's other linked trips.
function articleDetail(
  a: ArticleWithLikes & { articleTrips?: { tripId: string }[] },
  viewerId: string | undefined,
) {
  const isOwner = !!viewerId && viewerId === a.ownerId;
  return {
    ...articleSummary(a, viewerId),
    content: a.content,
    tripIds: isOwner ? (a.articleTrips ?? []).map((t) => t.tripId) : [],
  };
}

// --- Visibility ---------------------------------------------------------------

// An article is visible when the viewer is the author, the article is public,
// it is friends_only and they are friends, or the viewer is a member of any
// trip the article is linked to (context sharing — see the feature plan).
async function isArticleVisibleTo(
  article: { ownerId: string; visibility: string; articleTrips: { tripId: string }[] },
  viewerId: string | undefined,
): Promise<boolean> {
  if (article.visibility === "public") return true;
  if (!viewerId) return false;
  if (viewerId === article.ownerId) return true;
  if (article.visibility === "friends_only" && (await areFriends(viewerId, article.ownerId))) {
    return true;
  }
  const tripIds = article.articleTrips.map((t) => t.tripId);
  if (tripIds.length === 0) return false;
  const membership = await db.query.tripMembers.findFirst({
    where: and(inArray(tripMembers.tripId, tripIds), eq(tripMembers.userId, viewerId)),
    columns: { tripId: true },
  });
  return !!membership;
}

// ==============================================================================
// Public detail route (visibility-gated, no auth required)
// ==============================================================================

// Defined first so it can be embedded in articleRoutes BEFORE use("*", requireAuth).
// In Hono, use("*") only applies to handlers registered AFTER it, so registering
// this sub-router first ensures anonymous requests to GET /:articleId are not
// intercepted by requireAuth.
const articleDetailRoutes = new Hono<OptionalAuthEnv>();

articleDetailRoutes.get("/:articleId", optionalAuth, async (c) => {
  const articleId = getParam(c, "articleId");
  if (!isValidUuid(articleId)) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  const article = await db.query.articles.findFirst({
    where: eq(articles.id, articleId),
    with: { likes: { columns: { userId: true } }, articleTrips: { columns: { tripId: true } } },
  });
  // 404 (not 403) for hidden articles so existence isn't leaked.
  if (!article) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  const viewerId = c.get("user")?.id;
  if (!(await isArticleVisibleTo(article, viewerId))) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  return c.json(articleDetail(article, viewerId));
});

// ==============================================================================
// Authenticated routes (own articles + mutations)
// ==============================================================================

const articleRoutes = new Hono<AppEnv>();

// Embed the public detail sub-router BEFORE the authentication gate so that
// anonymous requests to GET /:articleId bypass requireAuth entirely.
// (use("*") in Hono only applies to handlers registered after it.)
articleRoutes.route("/", articleDetailRoutes);

articleRoutes.use("*", requireAuth);

// List own articles
articleRoutes.get("/", async (c) => {
  const user = c.get("user");

  const rows = await db.query.articles.findMany({
    where: eq(articles.ownerId, user.id),
    orderBy: articles.sortOrder,
    with: { likes: { columns: { userId: true } } },
  });

  return c.json(rows.map((a) => articleSummary(a, user.id)));
});

// Create article
articleRoutes.post("/", requireNonGuest, async (c) => {
  const user = c.get("user");

  const body = await c.req.json();
  const parsed = createArticleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const created = await db.transaction(async (tx) => {
    const [{ count: articleCount }] = await tx
      .select({ count: count() })
      .from(articles)
      .where(eq(articles.ownerId, user.id));

    if (articleCount >= MAX_ARTICLES_PER_USER) {
      return null;
    }

    // MAX+1, not COUNT: deleting a non-last article leaves a gap, and a
    // COUNT-based value would collide with an existing sortOrder (#137).
    const sortOrder = await getNextSortOrder(
      tx,
      articles.sortOrder,
      articles,
      eq(articles.ownerId, user.id),
      `article:user:${user.id}`,
    );

    const [result] = await tx
      .insert(articles)
      .values({
        ownerId: user.id,
        title: parsed.data.title,
        content: parsed.data.content,
        tags: parsed.data.tags,
        visibility: parsed.data.visibility,
        sortOrder,
      })
      .returning();

    return result;
  });

  if (!created) {
    return c.json({ error: ERROR_MSG.LIMIT_ARTICLES }, 409);
  }

  return c.json(articleDetail({ ...created, likes: [], articleTrips: [] }, user.id), 201);
});

// Reorder own articles
articleRoutes.patch("/reorder", requireNonGuest, async (c) => {
  const user = c.get("user");

  const body = await c.req.json();
  const parsed = reorderArticlesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const owned = await db.query.articles.findMany({
    where: eq(articles.ownerId, user.id),
    columns: { id: true },
  });
  const ownIds = new Set(owned.map((a) => a.id));
  if (!parsed.data.orderedIds.every((id) => ownIds.has(id))) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 400);
  }

  // Empty list is a no-op; skip CASE/WHEN to avoid a Postgres syntax error
  // ("CASE  END" with no WHEN clauses is invalid SQL).
  const { orderedIds } = parsed.data;
  if (orderedIds.length === 0) return c.json({ ok: true });

  // Bulk CASE/WHEN update avoids N round-trips to Postgres.
  await db
    .update(articles)
    .set({
      sortOrder: sql`CASE ${sql.join(
        orderedIds.map((id, i) => sql`WHEN ${articles.id} = ${id} THEN ${i}::integer`),
        sql` `,
      )} END`,
    })
    .where(inArray(articles.id, orderedIds));

  return c.json({ ok: true });
});

// Batch delete own articles
articleRoutes.post("/batch-delete", requireNonGuest, async (c) => {
  const user = c.get("user");

  const body = await c.req.json();
  const parsed = batchArticleIdsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { articleIds } = parsed.data;

  const owned = await db.query.articles.findMany({
    where: and(inArray(articles.id, articleIds), eq(articles.ownerId, user.id)),
    columns: { id: true },
  });
  if (owned.length !== articleIds.length) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  await db
    .delete(articles)
    .where(and(eq(articles.ownerId, user.id), inArray(articles.id, articleIds)));

  return c.json({ ok: true, deleted: articleIds.length });
});

// Update own article
articleRoutes.patch("/:articleId", requireNonGuest, async (c) => {
  const user = c.get("user");
  const articleId = getParam(c, "articleId");
  if (!isValidUuid(articleId)) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = updateArticleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.articles.findFirst({
    where: eq(articles.id, articleId),
    with: { likes: { columns: { userId: true } }, articleTrips: { columns: { tripId: true } } },
  });
  if (!existing || existing.ownerId !== user.id) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  if (!hasChanges(existing, parsed.data)) {
    return c.json(articleDetail(existing, user.id));
  }

  const [updated] = await db
    .update(articles)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(articles.id, articleId))
    .returning();

  return c.json(
    articleDetail(
      { ...updated, likes: existing.likes, articleTrips: existing.articleTrips },
      user.id,
    ),
  );
});

// Delete own article (cascades article_trips / article_likes)
articleRoutes.delete("/:articleId", requireNonGuest, async (c) => {
  const user = c.get("user");
  const articleId = getParam(c, "articleId");
  if (!isValidUuid(articleId)) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  const existing = await db.query.articles.findFirst({
    where: eq(articles.id, articleId),
    columns: { id: true, ownerId: true },
  });
  if (!existing || existing.ownerId !== user.id) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  await db.delete(articles).where(eq(articles.id, articleId));

  return c.json({ ok: true });
});

// Replace the full set of trips an article is linked to (idempotent).
articleRoutes.put("/:articleId/trips", requireNonGuest, async (c) => {
  const user = c.get("user");
  const articleId = getParam(c, "articleId");
  if (!isValidUuid(articleId)) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = setArticleTripsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.articles.findFirst({
    where: eq(articles.id, articleId),
    columns: { id: true, ownerId: true },
  });
  if (!existing || existing.ownerId !== user.id) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  const tripIds = parsed.data.tripIds;

  // Only trips the author is a member of may be linked — linking grants those
  // members visibility, so it must reflect a relationship the author actually has.
  if (tripIds.length > 0) {
    const memberRows = await db.query.tripMembers.findMany({
      where: and(inArray(tripMembers.tripId, tripIds), eq(tripMembers.userId, user.id)),
      columns: { tripId: true },
    });
    if (memberRows.length !== tripIds.length) {
      return c.json({ error: ERROR_MSG.ARTICLE_TRIP_FORBIDDEN }, 403);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(articleTrips).where(eq(articleTrips.articleId, articleId));
    if (tripIds.length > 0) {
      await tx.insert(articleTrips).values(tripIds.map((tripId) => ({ articleId, tripId })));
    }
  });

  return c.json({ ok: true, tripIds });
});

// Like a visible article (idempotent). Guests are excluded for consistency with
// other mutations — anonymous like counts would be meaningless.
articleRoutes.post("/:articleId/like", requireNonGuest, async (c) => {
  const user = c.get("user");
  const articleId = getParam(c, "articleId");
  if (!isValidUuid(articleId)) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  const article = await db.query.articles.findFirst({
    where: eq(articles.id, articleId),
    with: { likes: { columns: { userId: true } }, articleTrips: { columns: { tripId: true } } },
  });
  if (!article || !(await isArticleVisibleTo(article, user.id))) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  await db.insert(articleLikes).values({ articleId, userId: user.id }).onConflictDoNothing();

  // Re-count after the write so concurrent likes don't skew the returned total.
  const [counted] = await db
    .select({ value: count() })
    .from(articleLikes)
    .where(eq(articleLikes.articleId, articleId));
  return c.json({ liked: true, likeCount: counted?.value ?? 0 });
});

// Remove own like (idempotent). Guests are excluded for consistency with other mutations.
articleRoutes.delete("/:articleId/like", requireNonGuest, async (c) => {
  const user = c.get("user");
  const articleId = getParam(c, "articleId");
  if (!isValidUuid(articleId)) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  const article = await db.query.articles.findFirst({
    where: eq(articles.id, articleId),
    with: { likes: { columns: { userId: true } }, articleTrips: { columns: { tripId: true } } },
  });
  if (!article || !(await isArticleVisibleTo(article, user.id))) {
    return c.json({ error: ERROR_MSG.ARTICLE_NOT_FOUND }, 404);
  }

  await db
    .delete(articleLikes)
    .where(and(eq(articleLikes.articleId, articleId), eq(articleLikes.userId, user.id)));

  // Re-count after the write so concurrent likes don't skew the returned total.
  const [counted] = await db
    .select({ value: count() })
    .from(articleLikes)
    .where(eq(articleLikes.articleId, articleId));
  return c.json({ liked: false, likeCount: counted?.value ?? 0 });
});

// ==============================================================================
// Trip-scoped route: articles linked to a trip the viewer can access
// ==============================================================================

const tripArticleRoutes = new Hono<AppEnv>();
tripArticleRoutes.use("*", requireAuth);

// Members of a trip see every article linked to it regardless of its visibility
// (the whole point of context sharing).
tripArticleRoutes.get("/:tripId/articles", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  // Guard before the UUID column comparison: a non-UUID param would otherwise
  // make Postgres throw (invalid input syntax) and surface as a 500.
  if (!isValidUuid(tripId)) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const membership = await db.query.tripMembers.findFirst({
    where: and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, user.id)),
    columns: { tripId: true },
  });
  if (!membership) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const links = await db.query.articleTrips.findMany({
    where: eq(articleTrips.tripId, tripId),
    with: { article: { with: { likes: { columns: { userId: true } } } } },
  });

  const summaries = links
    .map((l) => l.article)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((a) => articleSummary(a, user.id));

  return c.json(summaries);
});

export { articleRoutes, articleDetailRoutes, tripArticleRoutes };
