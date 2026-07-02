import {
  createDayPatternSchema,
  overwriteDayPatternSchema,
  updateDayPatternSchema,
} from "@sugara/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { dayPatterns } from "../db/schema";
import { logActivity } from "../lib/activity-logger";
import { ERROR_MSG } from "../lib/constants";
import { hasChanges } from "../lib/has-changes";
import { getParam } from "../lib/params";
import {
  createDayPatternCore,
  duplicateDayPatternCore,
  overwriteDayPatternCore,
} from "../lib/pattern-service";
import { canEdit, verifyDayAccess } from "../lib/permissions";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const patternRoutes = new Hono<AppEnv>();
patternRoutes.use("*", requireAuth);

// List patterns for a day
patternRoutes.get("/:tripId/days/:dayId/patterns", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");

  const role = await verifyDayAccess(tripId, dayId, user.id);
  if (!role) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const patterns = await db.query.dayPatterns.findMany({
    where: eq(dayPatterns.tripDayId, dayId),
    orderBy: (v, { asc }) => [asc(v.sortOrder)],
    with: {
      schedules: {
        orderBy: (s, { asc }) => [asc(s.sortOrder)],
      },
    },
  });
  return c.json(patterns);
});

// Create pattern
patternRoutes.post("/:tripId/days/:dayId/patterns", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");

  const role = await verifyDayAccess(tripId, dayId, user.id);
  if (!canEdit(role)) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = createDayPatternSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const result = await createDayPatternCore(dayId, parsed.data.label);
  if (!result.ok) {
    return c.json({ error: ERROR_MSG.LIMIT_PATTERNS }, 409);
  }

  logActivity({
    tripId,
    userId: user.id,
    action: "created",
    entityType: "pattern",
    entityName: result.pattern.label,
  });

  return c.json(result.pattern, 201);
});

// Update pattern
patternRoutes.patch("/:tripId/days/:dayId/patterns/:patternId", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");
  const patternId = getParam(c, "patternId");

  const role = await verifyDayAccess(tripId, dayId, user.id);
  if (!canEdit(role)) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = updateDayPatternSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.dayPatterns.findFirst({
    where: and(eq(dayPatterns.id, patternId), eq(dayPatterns.tripDayId, dayId)),
  });
  if (!existing) {
    return c.json({ error: ERROR_MSG.PATTERN_NOT_FOUND }, 404);
  }

  if (!hasChanges(existing, parsed.data)) {
    return c.json(existing);
  }

  const [updated] = await db
    .update(dayPatterns)
    .set(parsed.data)
    .where(eq(dayPatterns.id, patternId))
    .returning();

  logActivity({
    tripId,
    userId: user.id,
    action: "updated",
    entityType: "pattern",
    entityName: updated.label,
  });

  return c.json(updated);
});

// Delete pattern (default cannot be deleted)
patternRoutes.delete("/:tripId/days/:dayId/patterns/:patternId", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");
  const patternId = getParam(c, "patternId");

  const role = await verifyDayAccess(tripId, dayId, user.id);
  if (!canEdit(role)) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const existing = await db.query.dayPatterns.findFirst({
    where: and(eq(dayPatterns.id, patternId), eq(dayPatterns.tripDayId, dayId)),
  });
  if (!existing) {
    return c.json({ error: ERROR_MSG.PATTERN_NOT_FOUND }, 404);
  }
  if (existing.isDefault) {
    return c.json({ error: ERROR_MSG.CANNOT_DELETE_DEFAULT }, 400);
  }

  await db.delete(dayPatterns).where(eq(dayPatterns.id, patternId));

  logActivity({
    tripId,
    userId: user.id,
    action: "deleted",
    entityType: "pattern",
    entityName: existing.label,
  });

  return c.json({ ok: true });
});

// Duplicate pattern (with schedules)
patternRoutes.post("/:tripId/days/:dayId/patterns/:patternId/duplicate", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");
  const patternId = getParam(c, "patternId");

  const role = await verifyDayAccess(tripId, dayId, user.id);
  if (!canEdit(role)) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const source = await db.query.dayPatterns.findFirst({
    where: and(eq(dayPatterns.id, patternId), eq(dayPatterns.tripDayId, dayId)),
    with: { schedules: true },
  });
  if (!source) {
    return c.json({ error: ERROR_MSG.PATTERN_NOT_FOUND }, 404);
  }

  const result = await duplicateDayPatternCore(tripId, dayId, source);
  if (!result.ok) {
    const message =
      result.error === "pattern_limit_reached"
        ? ERROR_MSG.LIMIT_PATTERNS
        : ERROR_MSG.LIMIT_SCHEDULES;
    return c.json({ error: message }, 409);
  }

  logActivity({
    tripId,
    userId: user.id,
    action: "duplicated",
    entityType: "pattern",
    entityName: result.pattern.label,
  });

  return c.json(result.pattern, 201);
});

// Overwrite pattern schedules with another pattern's schedules
patternRoutes.post("/:tripId/days/:dayId/patterns/:patternId/overwrite", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");
  const patternId = getParam(c, "patternId");

  const role = await verifyDayAccess(tripId, dayId, user.id);
  if (!canEdit(role)) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = overwriteDayPatternSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const [target, source] = await Promise.all([
    db.query.dayPatterns.findFirst({
      where: and(eq(dayPatterns.id, patternId), eq(dayPatterns.tripDayId, dayId)),
    }),
    db.query.dayPatterns.findFirst({
      where: and(eq(dayPatterns.id, parsed.data.sourcePatternId), eq(dayPatterns.tripDayId, dayId)),
      with: { schedules: true },
    }),
  ]);
  if (!target) {
    return c.json({ error: ERROR_MSG.PATTERN_NOT_FOUND }, 404);
  }
  if (!source) {
    return c.json({ error: ERROR_MSG.PATTERN_NOT_FOUND }, 404);
  }

  const result = await overwriteDayPatternCore(tripId, patternId, source);
  if (!result.ok) {
    return c.json({ error: ERROR_MSG.LIMIT_SCHEDULES }, 409);
  }

  logActivity({
    tripId,
    userId: user.id,
    action: "updated",
    entityType: "pattern",
    entityName: target.label,
  });

  return c.json({ ok: true });
});

export { patternRoutes };
