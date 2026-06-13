import {
  createDayPatternSchema,
  MAX_PATTERNS_PER_DAY,
  MAX_SCHEDULES_PER_TRIP,
  overwriteDayPatternSchema,
  updateDayPatternSchema,
} from "@sugara/shared";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { dayPatterns, schedules } from "../db/schema";
import { logActivity } from "../lib/activity-logger";
import { ERROR_MSG } from "../lib/constants";
import { hasChanges } from "../lib/has-changes";
import { getParam } from "../lib/params";
import { canEdit, verifyDayAccess } from "../lib/permissions";
import { buildScheduleCloneValues } from "../lib/schedule-clone";
import { getScheduleCount } from "../lib/schedule-count";
import { getNextSortOrder } from "../lib/sort-order";
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

  const [patternCount] = await db
    .select({ count: count() })
    .from(dayPatterns)
    .where(eq(dayPatterns.tripDayId, dayId));
  if (patternCount.count >= MAX_PATTERNS_PER_DAY) {
    return c.json({ error: ERROR_MSG.LIMIT_PATTERNS }, 409);
  }

  const pattern = await db.transaction(async (tx) => {
    const nextOrder = await getNextSortOrder(
      tx,
      dayPatterns.sortOrder,
      dayPatterns,
      eq(dayPatterns.tripDayId, dayId),
      `pattern:day:${dayId}`,
    );

    const [result] = await tx
      .insert(dayPatterns)
      .values({
        tripDayId: dayId,
        label: parsed.data.label,
        isDefault: false,
        sortOrder: nextOrder,
      })
      .returning();

    return result;
  });

  logActivity({
    tripId,
    userId: user.id,
    action: "created",
    entityType: "pattern",
    entityName: pattern.label,
  });

  return c.json(pattern, 201);
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

  const [source, [patternCount]] = await Promise.all([
    db.query.dayPatterns.findFirst({
      where: and(eq(dayPatterns.id, patternId), eq(dayPatterns.tripDayId, dayId)),
      with: { schedules: true },
    }),
    db.select({ count: count() }).from(dayPatterns).where(eq(dayPatterns.tripDayId, dayId)),
  ]);
  if (!source) {
    return c.json({ error: ERROR_MSG.PATTERN_NOT_FOUND }, 404);
  }
  if (patternCount.count >= MAX_PATTERNS_PER_DAY) {
    return c.json({ error: ERROR_MSG.LIMIT_PATTERNS }, 409);
  }

  const result = await db.transaction(async (tx) => {
    // Moved out of Promise.all so the advisory lock spans the same transaction
    // as the insert, making the read-then-insert atomic per scope (#146).
    const nextOrder = await getNextSortOrder(
      tx,
      dayPatterns.sortOrder,
      dayPatterns,
      eq(dayPatterns.tripDayId, dayId),
      `pattern:day:${dayId}`,
    );

    const [newPattern] = await tx
      .insert(dayPatterns)
      .values({
        tripDayId: dayId,
        label: `${source.label} (copy)`,
        isDefault: false,
        sortOrder: nextOrder,
      })
      .returning();

    if (source.schedules.length > 0) {
      await tx.insert(schedules).values(
        source.schedules.map((schedule) => ({
          tripId,
          dayPatternId: newPattern.id,
          ...buildScheduleCloneValues(schedule),
        })),
      );
    }

    return newPattern;
  });

  logActivity({
    tripId,
    userId: user.id,
    action: "duplicated",
    entityType: "pattern",
    entityName: result.label,
  });

  return c.json(result, 201);
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

  try {
    await db.transaction(async (tx) => {
      // Schedule limit: totalCount includes target's schedules, subtract them before adding source's
      const totalCount = await getScheduleCount(tx, tripId);
      const [{ count: targetCount }] = await tx
        .select({ count: count() })
        .from(schedules)
        .where(eq(schedules.dayPatternId, patternId));
      if (totalCount - targetCount + source.schedules.length > MAX_SCHEDULES_PER_TRIP) {
        throw new Error("SCHEDULE_LIMIT");
      }

      await tx.delete(schedules).where(eq(schedules.dayPatternId, patternId));

      if (source.schedules.length > 0) {
        await tx.insert(schedules).values(
          source.schedules.map((schedule) => ({
            tripId,
            dayPatternId: patternId,
            ...buildScheduleCloneValues(schedule),
          })),
        );
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "SCHEDULE_LIMIT") {
      return c.json({ error: ERROR_MSG.LIMIT_SCHEDULES }, 409);
    }
    throw err;
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
