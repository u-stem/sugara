import type { MemberRole } from "@sugara/shared";
import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { db } from "../../db";
import { articles, bookmarkLists, bookmarks, expenses, tripMembers, trips } from "../../db/schema";
import { verifyListOwnership } from "../../lib/bookmark-ownership";
import { v1AuditLog } from "../../lib/external-api/audit-log";
import { ApiV1Error, getApiKey, type V1Env, v1ErrorHandler } from "../../lib/external-api/errors";
import { buildMemberNoMap } from "../../lib/external-api/member-no";
import { v1RateLimit } from "../../lib/external-api/rate-limit";
import { checkTripAccess } from "../../lib/permissions";
import { requireApiKey } from "../../middleware/require-api-key";
import {
  articleDetailResponseSchema,
  articleListResponseSchema,
  bookmarkListsResponseSchema,
  bookmarksResponseSchema,
  errorResponseSchema,
  expenseListResponseSchema,
  tripDetailResponseSchema,
  tripListResponseSchema,
} from "./openapi-schemas";

// Rate limit for v1: generous cap for self-use (CLI / local LLM), IP-scoped.
// Fail-open by design (see rateLimitByIp). Concrete value is a rough stand-in;
// refine when public access is widened (§9 残課題).
const V1_RATE_LIMIT = { window: 60, max: 300 } as const;

export const v1App = new Hono<V1Env>();

v1App.onError(v1ErrorHandler);

// Audit log must be first so it wraps the entire request lifecycle and can
// observe the final status code regardless of what downstream middleware does.
v1App.use("*", v1AuditLog());

// Apply IP rate limit before auth so even unauthenticated bursts are throttled.
// v1RateLimit wraps rateLimitByIp and re-raises 429 as ApiV1Error so the v1
// error shape { error: { code, message } } is returned instead of the internal one.
v1App.use("*", v1RateLimit(V1_RATE_LIMIT));

// ---------- Shared UUID schema ----------

// z.guid() is the Zod v4 way to validate the 8-4-4-4-12 hex GUID format;
// z.string().uuid() enforces strict version/variant bits which rejects our
// test fixtures and user-supplied IDs from other generators.
const uuidSchema = z.string().check(z.guid());

// ---------- withTripAccess HOF ----------
//
// Returns a Hono route handler that structurally enforces trip membership:
//   1. Validates the path param is a valid UUID (400 if not)
//   2. Verifies the API key owner is a trip member via checkTripAccess (404 if not)
//   3. Calls the inner handler with (c, tripId, role)
//
// Using a HOF rather than middleware means the inner handler receives tripId and
// role as typed arguments and cannot be called without the check having run
// (no way to accidentally call the handler directly and skip the guard).
// The param name is a literal union so typos are caught at compile time.

type TripAccessHandler = (c: Context<V1Env>, tripId: string, role: MemberRole) => Promise<Response>;

function withTripAccess(paramName: "id" | "tripId", handler: TripAccessHandler) {
  return async (c: Context<V1Env>): Promise<Response> => {
    const rawId = c.req.param(paramName);
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid trip id");
    }
    const tripId = parsed.data;
    const key = getApiKey(c);
    const role = await checkTripAccess(tripId, key.userId);
    if (role === null) {
      throw new ApiV1Error(404, "not_found", "Trip not found or access denied");
    }
    return handler(c, tripId, role);
  };
}

// ---------- Shared query param schemas ----------

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const tripsQuerySchema = paginationSchema.extend({
  scope: z.enum(["owned", "shared"]).optional(),
});

// ---------- Helper: resolve a userId to its memberNo + displayName ----------
//
// Members in a trip are expected to always be present (fees cannot reference
// users outside the trip). When that invariant is violated (e.g. a member was
// removed outside the normal flow), we return just the displayName rather than
// crashing with a 500. See design doc §4.3 defensive fallback note.

type MemberRef = { memberNo: number; displayName: string } | { displayName: string };

function resolveMemberRef(
  memberNoMap: Map<string, number>,
  nameMap: Map<string, string>,
  userId: string,
): MemberRef {
  const memberNo = memberNoMap.get(userId);
  const displayName = nameMap.get(userId) ?? "Unknown";
  if (memberNo !== undefined) {
    return { memberNo, displayName };
  }
  // Defensive fallback: invariant broken — include displayName only
  return { displayName };
}

// ---------- GET /api/v1/trips ----------

v1App.get(
  "/trips",
  describeRoute({
    tags: ["Trips"],
    summary: "List trips",
    description:
      "Returns a paginated list of trips the API key owner is a member of. Requires `trips:read` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "scope",
        in: "query",
        description: "Filter by ownership role. Omit to return all trips.",
        schema: { type: "string", enum: ["owned", "shared"] },
      },
      {
        name: "limit",
        in: "query",
        description: "Maximum number of items to return (1–100, default 50).",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      {
        name: "offset",
        in: "query",
        description: "Number of items to skip.",
        schema: { type: "integer", minimum: 0, default: 0 },
      },
    ],
    responses: {
      200: {
        description: "Paginated trip list",
        content: { "application/json": { schema: resolver(tripListResponseSchema) } },
      },
      400: {
        description: "Invalid query parameters",
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
  requireApiKey("trips:read"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const parsed = tripsQuerySchema.safeParse({
      scope: c.req.query("scope"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid query parameters");
    }
    const { scope, limit: queryLimit, offset: queryOffset } = parsed.data;

    // scope=owned → owner role only; scope=shared → editor/viewer; omitted → both
    const roleFilter =
      scope === "owned"
        ? eq(tripMembers.role, "owner")
        : scope === "shared"
          ? ne(tripMembers.role, "owner")
          : undefined;

    // Total count for pagination metadata
    const countResult = await db
      .select({ total: count() })
      .from(tripMembers)
      .where(and(eq(tripMembers.userId, userId), roleFilter));
    const total = countResult[0]?.total ?? 0;

    // Fetch the page of trips (no mapsEnabled / totalSchedules)
    const tripRows = await db
      .select({
        id: trips.id,
        title: trips.title,
        startDate: trips.startDate,
        endDate: trips.endDate,
        currency: trips.currency,
        role: tripMembers.role,
        updatedAt: trips.updatedAt,
      })
      .from(tripMembers)
      .innerJoin(trips, eq(tripMembers.tripId, trips.id))
      .where(and(eq(tripMembers.userId, userId), roleFilter))
      .orderBy(desc(trips.updatedAt))
      .limit(queryLimit)
      .offset(queryOffset);

    // Member counts for the fetched trips (separate query to keep the join simple)
    const memberCountMap = new Map<string, number>();
    if (tripRows.length > 0) {
      const tripIds = tripRows.map((r) => r.id);
      const mcRows = await db
        .select({ tripId: tripMembers.tripId, memberCount: count() })
        .from(tripMembers)
        .where(inArray(tripMembers.tripId, tripIds))
        .groupBy(tripMembers.tripId);
      for (const row of mcRows) {
        memberCountMap.set(row.tripId, row.memberCount);
      }
    }

    const data = tripRows.map((r) => ({
      id: r.id,
      title: r.title,
      startDate: r.startDate ?? null,
      endDate: r.endDate ?? null,
      currency: r.currency,
      role: r.role,
      memberCount: memberCountMap.get(r.id) ?? 0,
      updatedAt: r.updatedAt.toISOString(),
    }));

    return c.json({
      data,
      pagination: { limit: queryLimit, offset: queryOffset, total },
    });
  },
);

// ---------- GET /api/v1/trips/:id ----------
//
// Returns full trip detail: basic fields, members[] with memberNo/displayName/role,
// and days[] with date and schedules[].

v1App.get(
  "/trips/:id",
  describeRoute({
    tags: ["Trips"],
    summary: "Get trip details",
    description:
      "Returns full trip detail including members with memberNo and days with schedules. Requires `trips:read` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        description: "Trip UUID.",
        schema: { type: "string", format: "uuid" },
      },
    ],
    responses: {
      200: {
        description: "Trip detail",
        content: { "application/json": { schema: resolver(tripDetailResponseSchema) } },
      },
      400: {
        description: "Invalid trip id",
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
        description: "Trip not found or access denied",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("trips:read"),
  withTripAccess("id", async (c, tripId, role) => {
    // Fetch trip with days → patterns → schedules
    const tripRow = await db.query.trips.findFirst({
      where: eq(trips.id, tripId),
      columns: {
        id: true,
        title: true,
        startDate: true,
        endDate: true,
        currency: true,
      },
      with: {
        days: {
          orderBy: (days, { asc }) => [asc(days.dayNumber)],
          columns: { id: true, date: true, dayNumber: true },
          with: {
            patterns: {
              orderBy: (patterns, { asc }) => [asc(patterns.sortOrder)],
              columns: { id: true },
              with: {
                schedules: {
                  orderBy: (scheds, { asc }) => [asc(scheds.sortOrder)],
                  columns: {
                    id: true,
                    name: true,
                    category: true,
                    startTime: true,
                    endTime: true,
                    address: true,
                    memo: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!tripRow) {
      // Row disappeared between checkTripAccess and this query (race condition).
      // Treat as not found.
      throw new ApiV1Error(404, "not_found", "Trip not found");
    }

    // Fetch members with user display names for the members[] array and memberNoMap
    const memberRows = await db.query.tripMembers.findMany({
      where: eq(tripMembers.tripId, tripId),
      columns: { userId: true, role: true },
      with: { user: { columns: { name: true } } },
    });

    const memberNoMap = buildMemberNoMap(memberRows);

    // Flatten schedules: collect all schedules from all patterns across all days
    const days = tripRow.days.map((day) => {
      const allSchedules = day.patterns.flatMap((p) => p.schedules);
      return {
        dayNumber: day.dayNumber,
        date: day.date,
        schedules: allSchedules.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category,
          startTime: s.startTime ?? null,
          endTime: s.endTime ?? null,
          address: s.address ?? null,
          memo: s.memo ?? null,
        })),
      };
    });

    const members = memberRows.map((m) => {
      const memberNo = memberNoMap.get(m.userId);
      return {
        ...(memberNo !== undefined ? { memberNo } : {}),
        displayName: m.user.name,
        role: m.role,
      };
    });

    return c.json({
      id: tripRow.id,
      title: tripRow.title,
      startDate: tripRow.startDate ?? null,
      endDate: tripRow.endDate ?? null,
      currency: tripRow.currency,
      role,
      members,
      days,
    });
  }),
);

// ---------- GET /api/v1/trips/:tripId/expenses ----------
//
// Returns paginated expenses for a trip. Each expense exposes paidBy and splits
// as { memberNo, displayName } references derived from the same stable map,
// ensuring memberNo values in this response are consistent with /trips/:id.

v1App.get(
  "/trips/:tripId/expenses",
  describeRoute({
    tags: ["Expenses"],
    summary: "List trip expenses",
    description:
      "Returns paginated expenses for a trip. paidBy and splits use memberNo for member identity. Requires `expenses:read` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "tripId",
        in: "path",
        required: true,
        description: "Trip UUID.",
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "limit",
        in: "query",
        description: "Maximum number of items to return (1–100, default 50).",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      {
        name: "offset",
        in: "query",
        description: "Number of items to skip.",
        schema: { type: "integer", minimum: 0, default: 0 },
      },
    ],
    responses: {
      200: {
        description: "Paginated expense list",
        content: { "application/json": { schema: resolver(expenseListResponseSchema) } },
      },
      400: {
        description: "Invalid query parameters or invalid trip UUID",
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
        description: "Trip not found or access denied",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("expenses:read"),
  withTripAccess("tripId", async (c, tripId) => {
    const parsed = paginationSchema.safeParse({
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid query parameters");
    }
    const { limit: queryLimit, offset: queryOffset } = parsed.data;

    // Build memberNo and name maps from current trip members
    const memberRows = await db.query.tripMembers.findMany({
      where: eq(tripMembers.tripId, tripId),
      columns: { userId: true },
      with: { user: { columns: { name: true } } },
    });

    const memberNoMap = buildMemberNoMap(memberRows);
    const nameMap = new Map(memberRows.map((m) => [m.userId, m.user.name]));

    // Count total for pagination
    const countResult = await db
      .select({ total: count() })
      .from(expenses)
      .where(eq(expenses.tripId, tripId));
    const total = countResult[0]?.total ?? 0;

    // Fetch page of expenses with payer and splits
    const expenseRows = await db.query.expenses.findMany({
      where: eq(expenses.tripId, tripId),
      columns: {
        id: true,
        title: true,
        amount: true,
        currency: true,
        category: true,
        paidByUserId: true,
        createdAt: true,
      },
      with: {
        paidByUser: { columns: { name: true } },
        splits: {
          columns: { userId: true, amount: true },
          with: { user: { columns: { name: true } } },
        },
      },
      orderBy: (exp, { desc: d }) => [d(exp.createdAt)],
      limit: queryLimit,
      offset: queryOffset,
    });

    const data = expenseRows.map((exp) => ({
      id: exp.id,
      title: exp.title,
      amount: exp.amount,
      currency: exp.currency,
      category: exp.category ?? null,
      date: exp.createdAt.toISOString(),
      paidBy: resolveMemberRef(memberNoMap, nameMap, exp.paidByUserId),
      splits: exp.splits.map((s) => ({
        ...resolveMemberRef(memberNoMap, nameMap, s.userId),
        amount: s.amount,
      })),
    }));

    return c.json({
      data,
      pagination: { limit: queryLimit, offset: queryOffset, total },
    });
  }),
);

// ---------- GET /api/v1/bookmark-lists ----------
//
// Returns the authenticated user's own bookmark lists with a bookmarkCount per list.

v1App.get(
  "/bookmark-lists",
  describeRoute({
    tags: ["Bookmarks"],
    summary: "List bookmark lists",
    description:
      "Returns the API key owner's bookmark lists with a bookmarkCount per list. Requires `bookmarks:read` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "limit",
        in: "query",
        description: "Maximum number of items to return (1–100, default 50).",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      {
        name: "offset",
        in: "query",
        description: "Number of items to skip.",
        schema: { type: "integer", minimum: 0, default: 0 },
      },
    ],
    responses: {
      200: {
        description: "Paginated bookmark list collection",
        content: { "application/json": { schema: resolver(bookmarkListsResponseSchema) } },
      },
      400: {
        description: "Invalid query parameters",
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
  requireApiKey("bookmarks:read"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const parsed = paginationSchema.safeParse({
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid query parameters");
    }
    const { limit: queryLimit, offset: queryOffset } = parsed.data;

    // Total count
    const countResult = await db
      .select({ total: count() })
      .from(bookmarkLists)
      .where(eq(bookmarkLists.userId, userId));
    const total = countResult[0]?.total ?? 0;

    // Fetch page of lists with nested bookmarks (id only) for counting
    const listRows = await db.query.bookmarkLists.findMany({
      where: eq(bookmarkLists.userId, userId),
      columns: {
        id: true,
        name: true,
        visibility: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        bookmarks: { columns: { id: true } },
      },
      orderBy: (lists, { asc }) => [asc(lists.sortOrder)],
      limit: queryLimit,
      offset: queryOffset,
    });

    const data = listRows.map((list) => ({
      id: list.id,
      name: list.name,
      visibility: list.visibility,
      sortOrder: list.sortOrder,
      bookmarkCount: list.bookmarks.length,
      createdAt: list.createdAt.toISOString(),
      updatedAt: list.updatedAt.toISOString(),
    }));

    return c.json({
      data,
      pagination: { limit: queryLimit, offset: queryOffset, total },
    });
  },
);

// ---------- GET /api/v1/bookmark-lists/:listId/bookmarks ----------
//
// Returns bookmarks in one of the user's own lists. Returns 404 for lists owned
// by other users (same behaviour as the internal route).

v1App.get(
  "/bookmark-lists/:listId/bookmarks",
  describeRoute({
    tags: ["Bookmarks"],
    summary: "List bookmarks in a list",
    description:
      "Returns bookmarks inside one of the API key owner's own lists. Returns 404 for lists owned by other users. Requires `bookmarks:read` scope.",
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
        name: "limit",
        in: "query",
        description: "Maximum number of items to return (1–100, default 50).",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      {
        name: "offset",
        in: "query",
        description: "Number of items to skip.",
        schema: { type: "integer", minimum: 0, default: 0 },
      },
    ],
    responses: {
      200: {
        description: "Paginated bookmark list",
        content: { "application/json": { schema: resolver(bookmarksResponseSchema) } },
      },
      400: {
        description: "Invalid list id",
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
        description: "List not found or access denied",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("bookmarks:read"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const rawListId = c.req.param("listId");
    const parsedId = uuidSchema.safeParse(rawListId);
    if (!parsedId.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid list id");
    }
    const listId = parsedId.data;

    const parsed = paginationSchema.safeParse({
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid query parameters");
    }
    const { limit: queryLimit, offset: queryOffset } = parsed.data;

    // Verify ownership before exposing bookmark contents
    const list = await verifyListOwnership(listId, userId);
    if (!list) {
      throw new ApiV1Error(404, "not_found", "Bookmark list not found or access denied");
    }

    // Count total bookmarks in this list
    const countResult = await db
      .select({ total: count() })
      .from(bookmarks)
      .where(eq(bookmarks.listId, listId));
    const total = countResult[0]?.total ?? 0;

    const bookmarkRows = await db.query.bookmarks.findMany({
      where: eq(bookmarks.listId, listId),
      columns: {
        id: true,
        name: true,
        memo: true,
        urls: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: (bm, { asc }) => [asc(bm.sortOrder)],
      limit: queryLimit,
      offset: queryOffset,
    });

    const data = bookmarkRows.map((bm) => ({
      id: bm.id,
      name: bm.name,
      memo: bm.memo ?? null,
      urls: bm.urls,
      sortOrder: bm.sortOrder,
      createdAt: bm.createdAt.toISOString(),
      updatedAt: bm.updatedAt.toISOString(),
    }));

    return c.json({
      data,
      pagination: { limit: queryLimit, offset: queryOffset, total },
    });
  },
);

// ---------- GET /api/v1/articles ----------
//
// Returns the authenticated user's own articles without the body (content is
// omitted for list efficiency — fetch /articles/:id for the full content).
// Visibility-based filtering is NOT applied: the v1 key owner only ever sees
// their own articles (ownerId === userId boundary is sufficient).

v1App.get(
  "/articles",
  describeRoute({
    tags: ["Articles"],
    summary: "List articles",
    description:
      "Returns the API key owner's articles without content. Fetch /articles/{id} for the full body. Requires `articles:read` scope.",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "limit",
        in: "query",
        description: "Maximum number of items to return (1–100, default 50).",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      {
        name: "offset",
        in: "query",
        description: "Number of items to skip.",
        schema: { type: "integer", minimum: 0, default: 0 },
      },
    ],
    responses: {
      200: {
        description: "Paginated article list (no content field)",
        content: { "application/json": { schema: resolver(articleListResponseSchema) } },
      },
      400: {
        description: "Invalid query parameters",
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
  requireApiKey("articles:read"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const parsed = paginationSchema.safeParse({
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    if (!parsed.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid query parameters");
    }
    const { limit: queryLimit, offset: queryOffset } = parsed.data;

    // Total count
    const countResult = await db
      .select({ total: count() })
      .from(articles)
      .where(eq(articles.ownerId, userId));
    const total = countResult[0]?.total ?? 0;

    // Fetch page of articles (no content) with linked trip ids
    const articleRows = await db.query.articles.findMany({
      where: eq(articles.ownerId, userId),
      columns: {
        id: true,
        title: true,
        tags: true,
        visibility: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        // content intentionally excluded from list view
      },
      with: {
        articleTrips: { columns: { tripId: true } },
      },
      orderBy: (arts, { asc }) => [asc(arts.sortOrder)],
      limit: queryLimit,
      offset: queryOffset,
    });

    const data = articleRows.map((a) => ({
      id: a.id,
      title: a.title,
      tags: a.tags,
      visibility: a.visibility,
      tripIds: a.articleTrips.map((t) => t.tripId),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }));

    return c.json({
      data,
      pagination: { limit: queryLimit, offset: queryOffset, total },
    });
  },
);

// ---------- GET /api/v1/articles/:id ----------
//
// Returns the full article including content. Returns 404 for articles owned
// by other users (existence concealment — prevents enumeration of other users'
// article ids via timing or status differences).

v1App.get(
  "/articles/:id",
  describeRoute({
    tags: ["Articles"],
    summary: "Get article details",
    description:
      "Returns the full article including content. Returns 404 for articles owned by other users (existence concealment). Requires `articles:read` scope.",
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
    responses: {
      200: {
        description: "Article detail with content",
        content: { "application/json": { schema: resolver(articleDetailResponseSchema) } },
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
      404: {
        description: "Article not found or access denied",
        content: { "application/json": { schema: resolver(errorResponseSchema) } },
      },
    },
  }),
  requireApiKey("articles:read"),
  async (c) => {
    const key = getApiKey(c);
    const userId = key.userId;

    const rawId = c.req.param("id");
    const parsedId = uuidSchema.safeParse(rawId);
    if (!parsedId.success) {
      throw new ApiV1Error(400, "invalid_request", "Invalid article id");
    }
    const articleId = parsedId.data;

    const article = await db.query.articles.findFirst({
      where: eq(articles.id, articleId),
      columns: {
        id: true,
        ownerId: true,
        title: true,
        content: true,
        tags: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
      },
      with: {
        articleTrips: { columns: { tripId: true } },
      },
    });

    // Existence concealment: 404 whether the article doesn't exist or belongs to
    // another user (same policy as bookmark lists — prevents id enumeration).
    if (!article || article.ownerId !== userId) {
      throw new ApiV1Error(404, "not_found", "Article not found or access denied");
    }

    return c.json({
      id: article.id,
      title: article.title,
      content: article.content,
      tags: article.tags,
      visibility: article.visibility,
      tripIds: article.articleTrips.map((t) => t.tripId),
      createdAt: article.createdAt.toISOString(),
      updatedAt: article.updatedAt.toISOString(),
    });
  },
);

// ---------- Catch-all ----------
//
// Terminal handler for any /api/v1 path not matched above. Without it, an
// unknown v1 path would fall through the mount into the parent app's chain
// (sibling routers' middleware, global notFound) and answer with an internal
// error shape. This keeps the entire /api/v1 namespace self-contained.
v1App.all("*", () => {
  throw new ApiV1Error(404, "not_found", "Not found");
});
