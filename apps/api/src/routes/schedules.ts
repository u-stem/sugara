import {
  batchScheduleIdsSchema,
  batchShiftSchedulesSchema,
  batchUnassignSchedulesSchema,
  createScheduleSchema,
  MAX_SCHEDULES_PER_TRIP,
  reorderSchedulesSchema,
  shiftTime,
  updateScheduleSchema,
} from "@sugara/shared";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { schedules } from "../db/schema";
import { logActivity } from "../lib/activity-logger";
import { validateAnchors } from "../lib/anchor-validate";
import { ERROR_MSG } from "../lib/constants";
import { hasChanges } from "../lib/has-changes";
import { notifyTripMembersExcluding } from "../lib/notifications";
import { getParam } from "../lib/params";
import { canEdit, verifyPatternAccess } from "../lib/permissions";
import { buildScheduleCloneValues } from "../lib/schedule-clone";
import { getScheduleCount } from "../lib/schedule-count";
import { getNextSortOrder } from "../lib/sort-order";
import { requireAuth } from "../middleware/auth";
import { requireTripAccess } from "../middleware/require-trip-access";
import type { AppEnv } from "../types";

const scheduleRoutes = new Hono<AppEnv>();
scheduleRoutes.use("*", requireAuth);

// Pattern-level routes (/:tripId/days/:dayId/patterns/:patternId/...) use verifyPatternAccess
// to verify the full trip -> day -> pattern hierarchy. Trip-level routes (/:tripId/schedules/...)
// use requireTripAccess middleware since they only need trip membership verification.

// List schedules for a pattern
scheduleRoutes.get("/:tripId/days/:dayId/patterns/:patternId/schedules", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");
  const patternId = getParam(c, "patternId");

  const role = await verifyPatternAccess(tripId, dayId, patternId, user.id);
  if (!role) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const patternSchedules = await db.query.schedules.findMany({
    where: eq(schedules.dayPatternId, patternId),
    orderBy: (schedules, { asc }) => [asc(schedules.sortOrder)],
  });
  return c.json(patternSchedules);
});

// Add schedule
scheduleRoutes.post("/:tripId/days/:dayId/patterns/:patternId/schedules", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");
  const patternId = getParam(c, "patternId");

  const role = await verifyPatternAccess(tripId, dayId, patternId, user.id);
  if (!canEdit(role)) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = createScheduleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const schedule = await db.transaction(async (tx) => {
    const scheduleCount = await getScheduleCount(tx, tripId);
    if (scheduleCount >= MAX_SCHEDULES_PER_TRIP) {
      return null;
    }

    const nextOrder = await getNextSortOrder(
      tx,
      schedules.sortOrder,
      schedules,
      eq(schedules.dayPatternId, patternId),
      `schedule:pattern:${patternId}`,
    );

    // Anchors are never set on create — they can only be set via the reorder
    // endpoint after the schedule has a stable id to reference.
    const { crossDayAnchor: _a, crossDayAnchorSourceId: _s, ...createData } = parsed.data;

    const [result] = await tx
      .insert(schedules)
      .values({
        tripId,
        dayPatternId: patternId,
        ...createData,
        sortOrder: nextOrder,
      })
      .returning();

    return result;
  });

  if (!schedule) {
    return c.json({ error: ERROR_MSG.LIMIT_SCHEDULES }, 409);
  }

  logActivity({
    tripId,
    userId: user.id,
    action: "created",
    entityType: "schedule",
    entityName: schedule.name,
  });

  notifyTripMembersExcluding({
    type: "schedule_created",
    tripId,
    actorId: user.id,
    makePayload: (tripName) => ({ actorName: user.name, tripName, entityName: schedule.name }),
  });

  return c.json(schedule, 201);
});

// Batch delete schedules from a pattern
scheduleRoutes.post(
  "/:tripId/days/:dayId/patterns/:patternId/schedules/batch-delete",
  async (c) => {
    const user = c.get("user");
    const tripId = getParam(c, "tripId");
    const dayId = getParam(c, "dayId");
    const patternId = getParam(c, "patternId");

    const role = await verifyPatternAccess(tripId, dayId, patternId, user.id);
    if (!canEdit(role)) {
      return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
    }

    const body = await c.req.json();
    const parsed = batchScheduleIdsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const targetSchedules = await db.query.schedules.findMany({
      where: and(
        inArray(schedules.id, parsed.data.scheduleIds),
        eq(schedules.dayPatternId, patternId),
      ),
    });
    if (targetSchedules.length !== parsed.data.scheduleIds.length) {
      return c.json({ error: ERROR_MSG.SCHEDULE_NOT_FOUND }, 404);
    }

    await db
      .delete(schedules)
      .where(
        and(inArray(schedules.id, parsed.data.scheduleIds), eq(schedules.dayPatternId, patternId)),
      );

    logActivity({
      tripId,
      userId: user.id,
      action: "deleted",
      entityType: "schedule",
      detail: `${parsed.data.scheduleIds.length}件`,
    });

    return c.json({ ok: true });
  },
);

// Batch shift schedule times
scheduleRoutes.post("/:tripId/days/:dayId/patterns/:patternId/schedules/batch-shift", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");
  const patternId = getParam(c, "patternId");

  const role = await verifyPatternAccess(tripId, dayId, patternId, user.id);
  if (!canEdit(role)) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = batchShiftSchedulesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { scheduleIds, deltaMinutes } = parsed.data;

  const targetSchedules = await db.query.schedules.findMany({
    where: and(inArray(schedules.id, scheduleIds), eq(schedules.dayPatternId, patternId)),
  });
  if (targetSchedules.length !== scheduleIds.length) {
    return c.json({ error: ERROR_MSG.SCHEDULE_NOT_FOUND }, 404);
  }

  const updates: { id: string; startTime: string | null; endTime: string | null }[] = [];
  let skippedCount = 0;

  for (const schedule of targetSchedules) {
    // Skip any schedule that spans multiple days, regardless of category.
    // Shifting only startTime would leave endTime fixed and silently alter
    // the duration (e.g. night bus 22:00→06:00 would collapse by 30min).
    if (schedule.endDayOffset && schedule.endDayOffset > 0) {
      skippedCount++;
      continue;
    }

    // Skip schedules without any time
    if (!schedule.startTime && !schedule.endTime) {
      skippedCount++;
      continue;
    }

    let newStartTime = schedule.startTime;
    let newEndTime = schedule.endTime;
    let shouldSkip = false;

    if (schedule.startTime) {
      const shifted = shiftTime(schedule.startTime, deltaMinutes);
      if (shifted === null) {
        shouldSkip = true;
      } else {
        newStartTime = shifted;
      }
    }

    if (!shouldSkip && schedule.endTime) {
      const shifted = shiftTime(schedule.endTime, deltaMinutes);
      if (shifted === null) {
        shouldSkip = true;
      } else {
        newEndTime = shifted;
      }
    }

    if (shouldSkip) {
      skippedCount++;
      continue;
    }

    updates.push({ id: schedule.id, startTime: newStartTime, endTime: newEndTime });
  }

  const updatedCount = updates.length;

  if (updates.length > 0) {
    const updateIds = updates.map((u) => u.id);
    await db
      .update(schedules)
      .set({
        startTime: sql`CASE ${sql.join(
          updates.map((u) => sql`WHEN ${schedules.id} = ${u.id} THEN ${u.startTime}`),
          sql` `,
        )} ELSE ${schedules.startTime} END`,
        endTime: sql`CASE ${sql.join(
          updates.map((u) => sql`WHEN ${schedules.id} = ${u.id} THEN ${u.endTime}`),
          sql` `,
        )} ELSE ${schedules.endTime} END`,
        updatedAt: new Date(),
      })
      .where(inArray(schedules.id, updateIds));
  }

  if (updatedCount > 0) {
    const direction = deltaMinutes > 0 ? "後ろ" : "前";
    const abs = Math.abs(deltaMinutes);
    logActivity({
      tripId,
      userId: user.id,
      action: "updated",
      entityType: "schedule",
      detail: `${updatedCount}件の時間を${abs}分${direction}に移動`,
    });
  }

  return c.json({ updatedCount, skippedCount });
});

// Batch duplicate schedules in a pattern
scheduleRoutes.post(
  "/:tripId/days/:dayId/patterns/:patternId/schedules/batch-duplicate",
  async (c) => {
    const user = c.get("user");
    const tripId = getParam(c, "tripId");
    const dayId = getParam(c, "dayId");
    const patternId = getParam(c, "patternId");

    const role = await verifyPatternAccess(tripId, dayId, patternId, user.id);
    if (!canEdit(role)) {
      return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
    }

    const body = await c.req.json();
    const parsed = batchScheduleIdsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const scheduleCount = await getScheduleCount(db, tripId);
    if (scheduleCount + parsed.data.scheduleIds.length > MAX_SCHEDULES_PER_TRIP) {
      return c.json({ error: ERROR_MSG.LIMIT_SCHEDULES }, 409);
    }

    const targetSchedules = await db.query.schedules.findMany({
      where: and(
        inArray(schedules.id, parsed.data.scheduleIds),
        eq(schedules.dayPatternId, patternId),
      ),
    });
    if (targetSchedules.length !== parsed.data.scheduleIds.length) {
      return c.json({ error: ERROR_MSG.SCHEDULE_NOT_FOUND }, 404);
    }

    const scheduleById = new Map(targetSchedules.map((s) => [s.id, s]));
    const ordered = parsed.data.scheduleIds.reduce<typeof targetSchedules>((acc, id) => {
      const schedule = scheduleById.get(id);
      if (schedule) acc.push(schedule);
      return acc;
    }, []);

    const duplicated = await db.transaction(async (tx) => {
      let currentOrder = await getNextSortOrder(
        tx,
        schedules.sortOrder,
        schedules,
        eq(schedules.dayPatternId, patternId),
        `schedule:pattern:${patternId}`,
      );

      return tx
        .insert(schedules)
        .values(
          ordered.map((schedule) => ({
            tripId,
            dayPatternId: patternId,
            ...buildScheduleCloneValues(schedule, { sortOrder: currentOrder++ }),
          })),
        )
        .returning();
    });

    logActivity({
      tripId,
      userId: user.id,
      action: "duplicated",
      entityType: "schedule",
      detail: `${duplicated.length}件`,
    });

    return c.json(duplicated, 201);
  },
);

// Reorder schedules -- registered before /:scheduleId to avoid "reorder" matching as scheduleId
scheduleRoutes.patch("/:tripId/days/:dayId/patterns/:patternId/schedules/reorder", async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const dayId = getParam(c, "dayId");
  const patternId = getParam(c, "patternId");

  const role = await verifyPatternAccess(tripId, dayId, patternId, user.id);
  if (!canEdit(role)) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = reorderSchedulesSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const { scheduleIds, anchors, clearAnchors } = parsed.data;

  // Verify all schedules belong to this pattern before updating
  if (scheduleIds.length > 0) {
    const targetSchedules = await db.query.schedules.findMany({
      where: and(inArray(schedules.id, scheduleIds), eq(schedules.dayPatternId, patternId)),
      columns: { id: true },
    });
    if (targetSchedules.length !== scheduleIds.length) {
      return c.json({ error: ERROR_MSG.INVALID_REORDER }, 400);
    }
  }

  if (anchors && anchors.length > 0) {
    const check = await validateAnchors(db, tripId, patternId, anchors);
    if (check.ok === false) {
      return c.json({ error: check.message }, check.status);
    }
  }

  // reorderSchedulesSchema refine already rejects empty scheduleIds combined
  // with clearAnchors=true or non-empty anchors. What reaches here is the
  // idempotent variant: empty scheduleIds with no flags, or with only falsy
  // flags (clearAnchors=false, anchors=[]). Return early to skip the tx.
  if (scheduleIds.length === 0 && !clearAnchors && (!anchors || anchors.length === 0)) {
    return c.json({ ok: true });
  }

  await db.transaction(async (tx) => {
    if (scheduleIds.length > 0) {
      await tx
        .update(schedules)
        .set({
          sortOrder: sql`CASE ${sql.join(
            scheduleIds.map((id, i) => sql`WHEN ${schedules.id} = ${id} THEN ${i}::integer`),
            sql` `,
          )} END`,
        })
        .where(inArray(schedules.id, scheduleIds));
    }

    if (clearAnchors && scheduleIds.length > 0) {
      await tx
        .update(schedules)
        .set({ crossDayAnchor: null, crossDayAnchorSourceId: null })
        .where(inArray(schedules.id, scheduleIds));
    } else if (anchors && anchors.length > 0) {
      for (const a of anchors) {
        await tx
          .update(schedules)
          .set({
            crossDayAnchor: a.anchor,
            crossDayAnchorSourceId: a.anchorSourceId,
          })
          .where(eq(schedules.id, a.scheduleId));
      }
    }
  });

  return c.json({ ok: true });
});

// Update schedule
scheduleRoutes.patch(
  "/:tripId/days/:dayId/patterns/:patternId/schedules/:scheduleId",
  async (c) => {
    const user = c.get("user");
    const tripId = getParam(c, "tripId");
    const dayId = getParam(c, "dayId");
    const patternId = getParam(c, "patternId");
    const scheduleId = getParam(c, "scheduleId");

    const role = await verifyPatternAccess(tripId, dayId, patternId, user.id);
    if (!canEdit(role)) {
      return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
    }

    const body = await c.req.json();
    const parsed = updateScheduleSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const existing = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, scheduleId), eq(schedules.dayPatternId, patternId)),
    });

    if (!existing) {
      return c.json({ error: ERROR_MSG.SCHEDULE_NOT_FOUND }, 404);
    }

    const { expectedUpdatedAt, ...updateData } = parsed.data;

    if (!hasChanges(existing, updateData)) {
      return c.json(existing);
    }

    if (
      Object.hasOwn(updateData, "crossDayAnchor") ||
      Object.hasOwn(updateData, "crossDayAnchorSourceId")
    ) {
      const check = await validateAnchors(db, tripId, patternId, [
        {
          scheduleId,
          anchor: updateData.crossDayAnchor ?? null,
          anchorSourceId: updateData.crossDayAnchorSourceId ?? null,
        },
      ]);
      if (check.ok === false) {
        return c.json({ error: check.message }, check.status);
      }
    }

    // When endDayOffset is cleared, the schedule stops generating cross-day
    // entries, so any anchors pointing to it must be dropped to avoid
    // orphaned references lingering in the DB.
    const endDayOffsetCleared =
      Object.hasOwn(updateData, "endDayOffset") &&
      (updateData.endDayOffset === null || updateData.endDayOffset === 0) &&
      (existing.endDayOffset ?? 0) > 0;

    // Atomic optimistic lock: include updatedAt in WHERE clause
    const whereConditions = expectedUpdatedAt
      ? and(
          eq(schedules.id, scheduleId),
          sql`date_trunc('milliseconds', ${schedules.updatedAt}) = ${expectedUpdatedAt}::timestamptz`,
        )
      : eq(schedules.id, scheduleId);

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(schedules)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(whereConditions)
        .returning();
      if (!row) return null;

      if (endDayOffsetCleared) {
        await tx
          .update(schedules)
          .set({ crossDayAnchor: null, crossDayAnchorSourceId: null })
          .where(eq(schedules.crossDayAnchorSourceId, scheduleId));
      }

      return row;
    });

    if (!updated) {
      return c.json({ error: ERROR_MSG.CONFLICT }, 409);
    }

    logActivity({
      tripId,
      userId: user.id,
      action: "updated",
      entityType: "schedule",
      entityName: updated.name,
    });

    notifyTripMembersExcluding({
      type: "schedule_updated",
      tripId,
      actorId: user.id,
      makePayload: (tripName) => ({ actorName: user.name, tripName, entityName: updated.name }),
    });

    return c.json(updated);
  },
);

// Delete schedule
scheduleRoutes.delete(
  "/:tripId/days/:dayId/patterns/:patternId/schedules/:scheduleId",
  async (c) => {
    const user = c.get("user");
    const tripId = getParam(c, "tripId");
    const dayId = getParam(c, "dayId");
    const patternId = getParam(c, "patternId");
    const scheduleId = getParam(c, "scheduleId");

    const role = await verifyPatternAccess(tripId, dayId, patternId, user.id);
    if (!canEdit(role)) {
      return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
    }

    const existing = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, scheduleId), eq(schedules.dayPatternId, patternId)),
    });

    if (!existing) {
      return c.json({ error: ERROR_MSG.SCHEDULE_NOT_FOUND }, 404);
    }

    await db.delete(schedules).where(eq(schedules.id, scheduleId));

    logActivity({
      tripId,
      userId: user.id,
      action: "deleted",
      entityType: "schedule",
      entityName: existing.name,
    });

    notifyTripMembersExcluding({
      type: "schedule_deleted",
      tripId,
      actorId: user.id,
      makePayload: (tripName) => ({ actorName: user.name, tripName }),
    });

    return c.json({ ok: true });
  },
);

// Batch unassign schedules (move to candidates)
scheduleRoutes.post("/:tripId/schedules/batch-unassign", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = batchUnassignSchedulesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const assigned = await db.query.schedules.findMany({
    where: and(
      inArray(schedules.id, parsed.data.scheduleIds),
      eq(schedules.tripId, tripId),
      isNotNull(schedules.dayPatternId),
    ),
    with: { dayPattern: { with: { tripDay: true } } },
  });
  if (assigned.length !== parsed.data.scheduleIds.length) {
    return c.json({ error: ERROR_MSG.SCHEDULE_NOT_FOUND }, 404);
  }

  await db.transaction(async (tx) => {
    const nextOrder = await getNextSortOrder(
      tx,
      schedules.sortOrder,
      schedules,
      and(eq(schedules.tripId, tripId), isNull(schedules.dayPatternId)),
      `schedule:candidates:${tripId}`,
    );

    const ids = parsed.data.scheduleIds;
    // Candidates cannot have anchors (no dayPatternId → no cross-day context).
    await tx
      .update(schedules)
      .set({
        dayPatternId: null,
        sortOrder: sql`CASE ${sql.join(
          ids.map((id, i) => sql`WHEN ${schedules.id} = ${id} THEN ${nextOrder + i}::integer`),
          sql` `,
        )} END`,
        crossDayAnchor: null,
        crossDayAnchorSourceId: null,
        updatedAt: new Date(),
      })
      .where(inArray(schedules.id, ids));
  });

  logActivity({
    tripId,
    userId: user.id,
    action: "unassigned",
    entityType: "schedule",
    detail: `${parsed.data.scheduleIds.length}件`,
  });

  return c.json({ ok: true });
});

// Unassign schedule (move to candidates)
scheduleRoutes.post(
  "/:tripId/schedules/:scheduleId/unassign",
  requireTripAccess("editor"),
  async (c) => {
    const user = c.get("user");
    const tripId = getParam(c, "tripId");
    const scheduleId = getParam(c, "scheduleId");

    const existing = await db.query.schedules.findFirst({
      where: and(eq(schedules.id, scheduleId), eq(schedules.tripId, tripId)),
      with: { dayPattern: { with: { tripDay: true } } },
    });
    if (!existing || !existing.dayPatternId) {
      return c.json({ error: ERROR_MSG.SCHEDULE_NOT_FOUND }, 404);
    }

    // Candidates cannot have anchors (no dayPatternId → no cross-day context).
    const updated = await db.transaction(async (tx) => {
      const nextOrder = await getNextSortOrder(
        tx,
        schedules.sortOrder,
        schedules,
        and(eq(schedules.tripId, tripId), isNull(schedules.dayPatternId)),
        `schedule:candidates:${tripId}`,
      );

      const [row] = await tx
        .update(schedules)
        .set({
          dayPatternId: null,
          sortOrder: nextOrder,
          crossDayAnchor: null,
          crossDayAnchorSourceId: null,
          updatedAt: new Date(),
        })
        .where(eq(schedules.id, scheduleId))
        .returning();

      return row;
    });

    logActivity({
      tripId,
      userId: user.id,
      action: "unassigned",
      entityType: "schedule",
      entityName: updated.name,
    });

    return c.json(updated);
  },
);

export { scheduleRoutes };
