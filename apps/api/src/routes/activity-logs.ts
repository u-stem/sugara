import { and, desc, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { activityLogs, users } from "../db/schema";
import { MAX_LOGS_PER_TRIP } from "../lib/constants";
import { getParam } from "../lib/params";
import { requireAuth } from "../middleware/auth";
import { requireTripAccess } from "../middleware/require-trip-access";
import type { AppEnv } from "../types";

const activityLogRoutes = new Hono<AppEnv>();
activityLogRoutes.use("*", requireAuth);

// List activity logs for a trip
activityLogRoutes.get("/:tripId/activity-logs", requireTripAccess(), async (c) => {
  const tripId = getParam(c, "tripId");

  // Number("abc") is NaN and NaN survives Math.min/Math.max, so a non-numeric
  // limit would reach the SQL LIMIT clause; fall back to the default instead.
  const limitParam = Number(c.req.query("limit") || String(MAX_LOGS_PER_TRIP));
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(1, Math.floor(limitParam)), MAX_LOGS_PER_TRIP)
    : MAX_LOGS_PER_TRIP;
  const cursor = c.req.query("cursor");
  if (cursor && Number.isNaN(Date.parse(cursor))) {
    return c.json({ error: "Invalid cursor" }, 400);
  }

  const whereConditions = cursor
    ? and(eq(activityLogs.tripId, tripId), lt(activityLogs.createdAt, new Date(cursor)))
    : eq(activityLogs.tripId, tripId);

  const logs = await db
    .select({
      id: activityLogs.id,
      userId: activityLogs.userId,
      userName: users.name,
      action: activityLogs.action,
      entityType: activityLogs.entityType,
      entityName: activityLogs.entityName,
      detail: activityLogs.detail,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .innerJoin(users, eq(activityLogs.userId, users.id))
    .where(whereConditions)
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit + 1);

  const hasMore = logs.length > limit;
  const items = hasMore ? logs.slice(0, limit) : logs;
  const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null;

  return c.json({
    items: items.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
    nextCursor,
  });
});

export { activityLogRoutes };
