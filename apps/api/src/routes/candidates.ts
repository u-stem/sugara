import {
  assignCandidateSchema,
  batchAssignCandidatesSchema,
  batchBookmarkIdsSchema,
  batchScheduleIdsSchema,
  createCandidateSchema,
  MAX_SCHEDULES_PER_TRIP,
  reorderSchedulesSchema,
  updateScheduleSchema,
} from "@sugara/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { bookmarks, dayPatterns, schedules } from "../db/schema";
import { logActivity } from "../lib/activity-logger";
import { queryCandidatesWithReactions } from "../lib/candidate-query";
import { createCandidateCore } from "../lib/candidate-service";
import { ERROR_MSG } from "../lib/constants";
import { hasChanges } from "../lib/has-changes";
import { notifyTripMembersExcluding } from "../lib/notifications";
import { getParam } from "../lib/params";
import { assignScheduleToPattern } from "../lib/schedule-assignment";
import { buildScheduleCloneValues } from "../lib/schedule-clone";
import { getScheduleCount } from "../lib/schedule-count";
import { getNextSortOrder } from "../lib/sort-order";
import { requireAuth } from "../middleware/auth";
import { requireTripAccess } from "../middleware/require-trip-access";
import type { AppEnv } from "../types";

const candidateRoutes = new Hono<AppEnv>();
candidateRoutes.use("*", requireAuth);

// List candidates for a trip
candidateRoutes.get("/:tripId/candidates", requireTripAccess(), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const candidates = await queryCandidatesWithReactions(tripId, user.id);
  return c.json(candidates);
});

// Create candidate
candidateRoutes.post("/:tripId/candidates", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = createCandidateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const result = await createCandidateCore(tripId, parsed.data);
  if (!result.ok) {
    return c.json({ error: ERROR_MSG.LIMIT_SCHEDULES }, 409);
  }
  const schedule = result.schedule;

  logActivity({
    tripId,
    userId: user.id,
    action: "created",
    entityType: "candidate",
    entityName: schedule.name,
  });

  notifyTripMembersExcluding({
    type: "candidate_created",
    tripId,
    actorId: user.id,
    makePayload: (tripName) => ({ actorName: user.name, tripName, entityName: schedule.name }),
  });

  return c.json(schedule, 201);
});

// Batch assign candidates to a day pattern
candidateRoutes.post("/:tripId/candidates/batch-assign", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = batchAssignCandidatesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const [candidates, pattern] = await Promise.all([
    db.query.schedules.findMany({
      where: and(
        inArray(schedules.id, parsed.data.scheduleIds),
        eq(schedules.tripId, tripId),
        isNull(schedules.dayPatternId),
      ),
    }),
    db.query.dayPatterns.findFirst({
      where: eq(dayPatterns.id, parsed.data.dayPatternId),
      with: { tripDay: true },
    }),
  ]);
  if (candidates.length !== parsed.data.scheduleIds.length) {
    return c.json({ error: ERROR_MSG.CANDIDATE_NOT_FOUND }, 404);
  }
  if (!pattern || pattern.tripDay.tripId !== tripId) {
    return c.json({ error: ERROR_MSG.PATTERN_NOT_FOUND }, 404);
  }

  await db.transaction(async (tx) => {
    const baseOrder = await getNextSortOrder(
      tx,
      schedules.sortOrder,
      schedules,
      eq(schedules.dayPatternId, parsed.data.dayPatternId),
      `schedule:pattern:${parsed.data.dayPatternId}`,
    );

    const ids = parsed.data.scheduleIds;
    const now = new Date();
    const cases = ids.map((id, i) => sql`when ${schedules.id} = ${id} then ${baseOrder + i}`);
    await tx
      .update(schedules)
      .set({
        dayPatternId: parsed.data.dayPatternId,
        sortOrder: sql`case ${sql.join(cases, sql` `)} else ${schedules.sortOrder} end`,
        updatedAt: now,
      })
      .where(inArray(schedules.id, ids));
  });

  logActivity({
    tripId,
    userId: user.id,
    action: "assigned",
    entityType: "candidate",
    detail: `${parsed.data.scheduleIds.length}件`,
  });

  return c.json({ ok: true });
});

// Batch delete candidates
candidateRoutes.post("/:tripId/candidates/batch-delete", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = batchScheduleIdsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const candidates = await db.query.schedules.findMany({
    where: and(
      inArray(schedules.id, parsed.data.scheduleIds),
      eq(schedules.tripId, tripId),
      isNull(schedules.dayPatternId),
    ),
  });
  if (candidates.length !== parsed.data.scheduleIds.length) {
    return c.json({ error: ERROR_MSG.CANDIDATE_NOT_FOUND }, 404);
  }

  await db
    .delete(schedules)
    .where(
      and(
        inArray(schedules.id, parsed.data.scheduleIds),
        eq(schedules.tripId, tripId),
        isNull(schedules.dayPatternId),
      ),
    );

  logActivity({
    tripId,
    userId: user.id,
    action: "deleted",
    entityType: "candidate",
    detail: `${parsed.data.scheduleIds.length}件`,
  });

  return c.json({ ok: true });
});

// Batch duplicate candidates
candidateRoutes.post(
  "/:tripId/candidates/batch-duplicate",
  requireTripAccess("editor"),
  async (c) => {
    const user = c.get("user");
    const tripId = getParam(c, "tripId");

    const body = await c.req.json();
    const parsed = batchScheduleIdsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const scheduleCount = await getScheduleCount(db, tripId);
    if (scheduleCount + parsed.data.scheduleIds.length > MAX_SCHEDULES_PER_TRIP) {
      return c.json({ error: ERROR_MSG.LIMIT_SCHEDULES }, 409);
    }

    const candidates = await db.query.schedules.findMany({
      where: and(
        inArray(schedules.id, parsed.data.scheduleIds),
        eq(schedules.tripId, tripId),
        isNull(schedules.dayPatternId),
      ),
    });
    if (candidates.length !== parsed.data.scheduleIds.length) {
      return c.json({ error: ERROR_MSG.CANDIDATE_NOT_FOUND }, 404);
    }

    // Preserve the order of scheduleIds in the request
    const scheduleById = new Map(candidates.map((s) => [s.id, s]));
    const ordered = parsed.data.scheduleIds.reduce<typeof candidates>((acc, id) => {
      const schedule = scheduleById.get(id);
      if (schedule) acc.push(schedule);
      return acc;
    }, []);

    const duplicated = await db.transaction(async (tx) => {
      let nextOrder = await getNextSortOrder(
        tx,
        schedules.sortOrder,
        schedules,
        and(eq(schedules.tripId, tripId), isNull(schedules.dayPatternId)),
        `schedule:candidates:${tripId}`,
      );

      return tx
        .insert(schedules)
        .values(
          ordered.map((schedule) => ({
            tripId,
            ...buildScheduleCloneValues(schedule, { sortOrder: nextOrder++ }),
          })),
        )
        .returning();
    });

    logActivity({
      tripId,
      userId: user.id,
      action: "duplicated",
      entityType: "candidate",
      detail: `${duplicated.length}件`,
    });

    return c.json(duplicated, 201);
  },
);

// Create candidates from bookmarks
candidateRoutes.post(
  "/:tripId/candidates/from-bookmarks",
  requireTripAccess("editor"),
  async (c) => {
    const user = c.get("user");
    const tripId = getParam(c, "tripId");

    const body = await c.req.json();
    const parsed = batchBookmarkIdsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    // Verify all bookmarks belong to the user (via their bookmark lists)
    const found = await db.query.bookmarks.findMany({
      where: inArray(bookmarks.id, parsed.data.bookmarkIds),
      with: { list: { columns: { userId: true } } },
    });
    // Preserve the order of bookmarkIds in the request (db query order is not guaranteed)
    const bookmarkById = new Map(found.map((bm) => [bm.id, bm]));
    const owned = parsed.data.bookmarkIds
      .map((id) => bookmarkById.get(id))
      .filter((bm): bm is NonNullable<typeof bm> => bm !== undefined && bm.list.userId === user.id);
    if (owned.length !== parsed.data.bookmarkIds.length) {
      return c.json({ error: ERROR_MSG.BOOKMARK_OWNER_MISMATCH }, 404);
    }

    const scheduleCount = await getScheduleCount(db, tripId);
    if (scheduleCount + owned.length > MAX_SCHEDULES_PER_TRIP) {
      return c.json({ error: ERROR_MSG.LIMIT_SCHEDULES }, 409);
    }

    const created = await db.transaction(async (tx) => {
      let nextOrder = await getNextSortOrder(
        tx,
        schedules.sortOrder,
        schedules,
        and(eq(schedules.tripId, tripId), isNull(schedules.dayPatternId)),
        `schedule:candidates:${tripId}`,
      );

      return tx
        .insert(schedules)
        .values(
          owned.map((bm) => ({
            tripId,
            dayPatternId: null,
            name: bm.name,
            memo: bm.memo,
            urls: bm.urls,
            category: "sightseeing" as const,
            color: "blue" as const,
            sortOrder: nextOrder++,
          })),
        )
        .returning();
    });

    logActivity({
      tripId,
      userId: user.id,
      action: "created",
      entityType: "candidate",
      detail: `${created.length}件（ブックマークから）`,
    });

    return c.json(created, 201);
  },
);

// Reorder candidates (registered before /:scheduleId to avoid route conflict)
candidateRoutes.patch("/:tripId/candidates/reorder", requireTripAccess("editor"), async (c) => {
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = reorderSchedulesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  if (parsed.data.scheduleIds.length > 0) {
    const targets = await db.query.schedules.findMany({
      where: and(
        inArray(schedules.id, parsed.data.scheduleIds),
        eq(schedules.tripId, tripId),
        isNull(schedules.dayPatternId),
      ),
    });
    if (targets.length !== parsed.data.scheduleIds.length) {
      return c.json({ error: ERROR_MSG.INVALID_CANDIDATE_REORDER }, 400);
    }
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.data.scheduleIds.length; i++) {
      await tx
        .update(schedules)
        .set({ sortOrder: i })
        .where(eq(schedules.id, parsed.data.scheduleIds[i]));
    }
  });

  return c.json({ ok: true });
});

// Update candidate
candidateRoutes.patch("/:tripId/candidates/:scheduleId", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const scheduleId = getParam(c, "scheduleId");

  const body = await c.req.json();
  const parsed = updateScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.schedules.findFirst({
    where: and(
      eq(schedules.id, scheduleId),
      eq(schedules.tripId, tripId),
      isNull(schedules.dayPatternId),
    ),
  });
  if (!existing) {
    return c.json({ error: ERROR_MSG.CANDIDATE_NOT_FOUND }, 404);
  }

  const {
    expectedUpdatedAt,
    crossDayAnchor: _a,
    crossDayAnchorSourceId: _s,
    ...updateData
  } = parsed.data;

  if (!hasChanges(existing, updateData)) {
    return c.json(existing);
  }

  // Atomic optimistic lock: include updatedAt in WHERE clause
  const whereConditions = expectedUpdatedAt
    ? and(
        eq(schedules.id, scheduleId),
        sql`date_trunc('milliseconds', ${schedules.updatedAt}) = ${expectedUpdatedAt}::timestamptz`,
      )
    : eq(schedules.id, scheduleId);

  const [updated] = await db
    .update(schedules)
    .set({ ...updateData, updatedAt: new Date() })
    .where(whereConditions)
    .returning();

  if (!updated) {
    return c.json({ error: ERROR_MSG.CONFLICT }, 409);
  }

  logActivity({
    tripId,
    userId: user.id,
    action: "updated",
    entityType: "candidate",
    entityName: updated.name,
  });

  return c.json(updated);
});

// Delete candidate
candidateRoutes.delete(
  "/:tripId/candidates/:scheduleId",
  requireTripAccess("editor"),
  async (c) => {
    const user = c.get("user");
    const tripId = getParam(c, "tripId");
    const scheduleId = getParam(c, "scheduleId");

    const existing = await db.query.schedules.findFirst({
      where: and(
        eq(schedules.id, scheduleId),
        eq(schedules.tripId, tripId),
        isNull(schedules.dayPatternId),
      ),
    });
    if (!existing) {
      return c.json({ error: ERROR_MSG.CANDIDATE_NOT_FOUND }, 404);
    }

    await db.delete(schedules).where(eq(schedules.id, scheduleId));

    logActivity({
      tripId,
      userId: user.id,
      action: "deleted",
      entityType: "candidate",
      entityName: existing.name,
    });

    notifyTripMembersExcluding({
      type: "candidate_deleted",
      tripId,
      actorId: user.id,
      makePayload: (tripName) => ({ actorName: user.name, tripName }),
    });

    return c.json({ ok: true });
  },
);

// Assign candidate to a day pattern
candidateRoutes.post(
  "/:tripId/candidates/:scheduleId/assign",
  requireTripAccess("editor"),
  async (c) => {
    const user = c.get("user");
    const tripId = getParam(c, "tripId");
    const scheduleId = getParam(c, "scheduleId");

    const body = await c.req.json();
    const parsed = assignCandidateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const existing = await db.query.schedules.findFirst({
      where: and(
        eq(schedules.id, scheduleId),
        eq(schedules.tripId, tripId),
        isNull(schedules.dayPatternId),
      ),
    });
    if (!existing) {
      return c.json({ error: ERROR_MSG.CANDIDATE_NOT_FOUND }, 404);
    }

    const pattern = await db.query.dayPatterns.findFirst({
      where: eq(dayPatterns.id, parsed.data.dayPatternId),
      with: { tripDay: true },
    });
    if (!pattern || pattern.tripDay.tripId !== tripId) {
      return c.json({ error: ERROR_MSG.PATTERN_NOT_FOUND }, 404);
    }

    const updated = await assignScheduleToPattern(scheduleId, parsed.data.dayPatternId);

    logActivity({
      tripId,
      userId: user.id,
      action: "assigned",
      entityType: "candidate",
      entityName: updated.name,
    });

    return c.json(updated);
  },
);

export { candidateRoutes };
