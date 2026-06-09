import { and, count, desc, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db";
import { tripMembers, trips } from "../../db/schema";
import { v1AuditLog } from "../../lib/external-api/audit-log";
import { ApiV1Error, getApiKey, type V1Env, v1ErrorHandler } from "../../lib/external-api/errors";
import { v1RateLimit } from "../../lib/external-api/rate-limit";
import { requireApiKey } from "../../middleware/require-api-key";

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

// Zod schema for query params. z.coerce.number() handles string → number
// conversion; .default() intercepts undefined before coercion fires.
const tripsQuerySchema = z.object({
  scope: z.enum(["owned", "shared"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// GET /api/v1/trips
// Returns trips the key owner can access (as a trip member) with external DTO.
// mapsEnabled / totalSchedules and other internal fields are intentionally absent.
v1App.get("/trips", requireApiKey("trips:read"), async (c) => {
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
});
