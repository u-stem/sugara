import type { CurrencyCode } from "@sugara/shared";
import {
  createTripSchema,
  createTripWithPollSchema,
  STATUS_LABELS,
  updateTripSchema,
} from "@sugara/shared";
import { and, count, desc, eq, getTableColumns, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  dayPatterns,
  expenses,
  schedulePollOptions,
  schedulePollParticipants,
  schedulePolls,
  schedules,
  tripDays,
  tripMembers,
  trips,
} from "../db/schema";
import { logActivity } from "../lib/activity-logger";
import type { MapsMode } from "../lib/app-settings";
import { getAppSettings } from "../lib/app-settings";
import { queryCandidatesWithReactions } from "../lib/candidate-query";
import { ERROR_MSG } from "../lib/constants";
import { logger } from "../lib/logger";
import { getParam } from "../lib/params";
import { getAdminUserId } from "../lib/resolve-is-admin";
import { buildScheduleCloneValues } from "../lib/schedule-clone";
import {
  copyCoverImage,
  deleteCoverImage,
  uploadCoverImage,
  validateCoverImage,
} from "../lib/storage";
import { createInitialTripDays, generateDateRange, syncTripDays } from "../lib/trip-days";
import { resolveTripLimit } from "../lib/trip-limit";
import { requireAuth } from "../middleware/auth";
import { requireTripAccess } from "../middleware/require-trip-access";
import type { AppEnv } from "../types";

function resolveMapsEnabled(mapsMode: MapsMode, isAdminTrip: boolean): boolean {
  if (mapsMode === "off") return false;
  if (mapsMode === "public") return true;
  return isAdminTrip;
}

const tripRoutes = new Hono<AppEnv>();
tripRoutes.use("*", requireAuth);

// List trips for current user, filtered by scope
tripRoutes.get("/", async (c) => {
  const user = c.get("user");
  const scope = c.req.query("scope");
  if (scope !== undefined && scope !== "owned" && scope !== "shared") {
    return c.json({ error: "Invalid scope parameter" }, 400);
  }

  const roleFilter =
    scope === "owned"
      ? eq(tripMembers.role, "owner")
      : scope === "shared"
        ? ne(tripMembers.role, "owner")
        : undefined;

  const tripColumns = getTableColumns(trips);

  // Run sequentially to avoid Supavisor pipeline stalls (see admin.ts fetchStats)
  const result = await db
    .select({
      ...tripColumns,
      role: tripMembers.role,
      totalSchedules: count(schedules.id),
      memberCount: sql<number>`(SELECT COUNT(*)::int FROM trip_members WHERE trip_members.trip_id = ${trips.id})`,
    })
    .from(tripMembers)
    .innerJoin(trips, eq(tripMembers.tripId, trips.id))
    .leftJoin(schedules, eq(trips.id, schedules.tripId))
    .where(and(eq(tripMembers.userId, user.id), roleFilter))
    .groupBy(trips.id, tripMembers.role)
    .orderBy(desc(trips.updatedAt));

  const listSettings = await getAppSettings();
  const adminUserId = listSettings.mapsMode === "admin_only" ? await getAdminUserId() : null;

  return c.json(
    result.map((t) => ({
      ...t,
      mapsEnabled: resolveMapsEnabled(listSettings.mapsMode, t.ownerId === adminUserId),
    })),
  );
});

// Create a trip (direct dates or poll mode)
tripRoutes.post("/", async (c) => {
  const user = c.get("user");

  // Guest: limit to 1 trip
  if (user.isAnonymous) {
    const existing = await db
      .select({ id: trips.id })
      .from(trips)
      .innerJoin(
        tripMembers,
        and(eq(tripMembers.tripId, trips.id), eq(tripMembers.userId, user.id)),
      )
      .limit(1);
    if (existing.length >= 1) {
      return c.json({ error: ERROR_MSG.GUEST_TRIP_LIMIT }, 403);
    }
  }

  const body = await c.req.json();
  const isPollMode = "pollOptions" in body;

  if (isPollMode) {
    const parsed = createTripWithPollSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }

    const {
      title,
      destination = null,
      pollOptions,
      coverImageUrl,
      coverImagePosition,
      currency,
    } = parsed.data;

    const trip = await db.transaction(async (tx) => {
      const [tripCount] = await tx
        .select({ count: count() })
        .from(trips)
        .where(eq(trips.ownerId, user.id));
      // Guests are pre-checked above, but guard again inside the transaction to
      // catch race conditions and return the same error code as the pre-check.
      const limit = user.isAnonymous ? 1 : await resolveTripLimit(tx, user.id);
      if (tripCount.count >= limit) {
        return user.isAnonymous ? ("GUEST_LIMIT" as const) : null;
      }

      const [created] = await tx
        .insert(trips)
        .values({
          ownerId: user.id,
          title,
          destination,
          status: "scheduling",
          coverImageUrl: coverImageUrl ?? null,
          coverImagePosition: coverImagePosition ?? 50,
          currency,
        })
        .returning();

      // No trip_days for scheduling status

      await tx.insert(tripMembers).values({
        tripId: created.id,
        userId: user.id,
        role: "owner" as const,
      });

      const [poll] = await tx
        .insert(schedulePolls)
        .values({
          tripId: created.id,
          note: null,
        })
        .returning();

      await tx.insert(schedulePollOptions).values(
        pollOptions.map((opt, i) => ({
          pollId: poll.id,
          startDate: opt.startDate,
          endDate: opt.endDate,
          sortOrder: i,
        })),
      );

      await tx.insert(schedulePollParticipants).values({
        pollId: poll.id,
        userId: user.id,
      });

      return created;
    });

    if (trip === "GUEST_LIMIT") {
      return c.json({ error: ERROR_MSG.GUEST_TRIP_LIMIT }, 403);
    }
    if (!trip) {
      return c.json({ error: ERROR_MSG.LIMIT_TRIPS }, 409);
    }

    logActivity({
      tripId: trip.id,
      userId: user.id,
      action: "created",
      entityType: "trip",
      entityName: trip.title,
    });

    logActivity({
      tripId: trip.id,
      userId: user.id,
      action: "created",
      entityType: "poll",
    });

    return c.json(trip, 201);
  }

  // Direct date mode
  const parsed = createTripSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const {
    title,
    destination = null,
    startDate,
    endDate,
    coverImageUrl,
    coverImagePosition,
    currency,
  } = parsed.data;

  const trip = await db.transaction(async (tx) => {
    const [tripCount] = await tx
      .select({ count: count() })
      .from(trips)
      .where(eq(trips.ownerId, user.id));
    // Guests are pre-checked above, but guard again inside the transaction to
    // catch race conditions and return the same error code as the pre-check.
    const limit = user.isAnonymous ? 1 : await resolveTripLimit(tx, user.id);
    if (tripCount.count >= limit) {
      return user.isAnonymous ? ("GUEST_LIMIT" as const) : null;
    }

    const [created] = await tx
      .insert(trips)
      .values({
        ownerId: user.id,
        title,
        destination,
        startDate,
        endDate,
        coverImageUrl: coverImageUrl ?? null,
        coverImagePosition: coverImagePosition ?? 50,
        currency,
      })
      .returning();

    await createInitialTripDays(tx, created.id, startDate, endDate);

    // Add owner as trip member
    await tx.insert(tripMembers).values({
      tripId: created.id,
      userId: user.id,
      role: "owner" as const,
    });

    return created;
  });

  if (trip === "GUEST_LIMIT") {
    return c.json({ error: ERROR_MSG.GUEST_TRIP_LIMIT }, 403);
  }
  if (!trip) {
    return c.json({ error: ERROR_MSG.LIMIT_TRIPS }, 409);
  }

  logActivity({
    tripId: trip.id,
    userId: user.id,
    action: "created",
    entityType: "trip",
    entityName: trip.title,
  });

  return c.json(trip, 201);
});

// Get trip detail with days and schedules (any member can view)
tripRoutes.get("/:id", requireTripAccess("viewer", "id"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "id");
  const role = c.get("tripRole");

  // Run sequentially to avoid Supavisor pipeline stalls (see admin.ts fetchStats)
  const tripWithPoll = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
        with: {
          patterns: {
            orderBy: (patterns, { asc }) => [asc(patterns.sortOrder)],
            with: {
              schedules: {
                orderBy: (schedules, { asc }) => [asc(schedules.sortOrder)],
              },
            },
          },
        },
      },
      poll: {
        columns: { id: true, status: true },
        with: {
          participants: {
            columns: { id: true },
            with: { responses: { columns: { participantId: true } } },
          },
        },
      },
    },
  });

  if (!tripWithPoll) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const candidates = await queryCandidatesWithReactions(tripId, user.id);
  const [{ count: memberCount }] = await db
    .select({ count: count() })
    .from(tripMembers)
    .where(eq(tripMembers.tripId, tripId));
  const [{ count: expenseCount }] = await db
    .select({ count: count() })
    .from(expenses)
    .where(eq(expenses.tripId, tripId));
  const detailSettings = await getAppSettings();

  const { poll: rawPoll, ...trip } = tripWithPoll;

  // Derive from already-fetched data instead of an extra DB query
  const scheduleCount =
    trip.days.flatMap((d) => d.patterns).flatMap((p) => p.schedules).length + candidates.length;

  const poll = rawPoll
    ? {
        id: rawPoll.id,
        status: rawPoll.status,
        participantCount: rawPoll.participants.length,
        respondedCount: rawPoll.participants.filter((p) => p.responses.length > 0).length,
      }
    : null;

  return c.json({
    ...trip,
    mapsEnabled: resolveMapsEnabled(
      detailSettings.mapsMode,
      detailSettings.mapsMode === "admin_only" ? trip.ownerId === (await getAdminUserId()) : false,
    ),
    role,
    candidates,
    scheduleCount,
    expenseCount,
    memberCount,
    poll,
  });
});

// Update trip (owner or editor)
tripRoutes.patch("/:id", requireTripAccess("editor", "id"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "id");
  const body = await c.req.json();
  const parsed = updateTripSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { startDate: newStart, endDate: newEnd, ...otherFields } = parsed.data;

  const currentTrip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
  });
  if (!currentTrip) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  const effectiveStart = newStart ?? currentTrip.startDate;
  const effectiveEnd = newEnd ?? currentTrip.endDate;
  const datesChanged =
    effectiveStart !== currentTrip.startDate || effectiveEnd !== currentTrip.endDate;

  if (datesChanged) {
    // Validate cross-field constraint when only one date is sent
    if (effectiveStart && effectiveEnd && effectiveEnd < effectiveStart) {
      return c.json(
        {
          error: {
            fieldErrors: { endDate: [ERROR_MSG.DATE_ORDER] },
            formErrors: [],
          },
        },
        400,
      );
    }

    // Reject date changes that reduce the number of days
    if (effectiveStart && effectiveEnd && currentTrip.startDate && currentTrip.endDate) {
      const currentDayCount = generateDateRange(currentTrip.startDate, currentTrip.endDate).length;
      const newDayCount = generateDateRange(effectiveStart, effectiveEnd).length;
      if (newDayCount < currentDayCount) {
        return c.json({ error: ERROR_MSG.TRIP_DAYS_REDUCED }, 400);
      }
    }
  }

  // Build update payload with only changed fields
  const updatePayload: Partial<typeof trips.$inferInsert> = {};
  if (otherFields.title !== undefined && otherFields.title !== currentTrip.title) {
    updatePayload.title = otherFields.title;
  }
  if (
    otherFields.destination !== undefined &&
    otherFields.destination !== currentTrip.destination
  ) {
    updatePayload.destination = otherFields.destination;
  }
  if (otherFields.status !== undefined && otherFields.status !== currentTrip.status) {
    updatePayload.status = otherFields.status;
  }
  if (
    otherFields.coverImageUrl !== undefined &&
    otherFields.coverImageUrl !== currentTrip.coverImageUrl
  ) {
    updatePayload.coverImageUrl = otherFields.coverImageUrl;
  }
  if (
    otherFields.coverImagePosition !== undefined &&
    otherFields.coverImagePosition !== currentTrip.coverImagePosition
  ) {
    updatePayload.coverImagePosition = otherFields.coverImagePosition;
  }
  if (
    otherFields.currency !== undefined &&
    otherFields.currency !== (currentTrip.currency as CurrencyCode)
  ) {
    // Reject currency change when trip already has expenses (amounts are in minor units)
    const [{ count: expenseCount }] = await db
      .select({ count: count() })
      .from(expenses)
      .where(eq(expenses.tripId, tripId));
    if (expenseCount > 0) {
      return c.json({ error: ERROR_MSG.TRIP_HAS_EXPENSES }, 409);
    }
    updatePayload.currency = otherFields.currency;
  }
  if (datesChanged) {
    if (effectiveStart !== currentTrip.startDate) updatePayload.startDate = effectiveStart;
    if (effectiveEnd !== currentTrip.endDate) updatePayload.endDate = effectiveEnd;
  }

  if (Object.keys(updatePayload).length === 0) {
    return c.json(currentTrip);
  }

  let updated: typeof currentTrip | null | undefined;

  if (datesChanged && effectiveStart && effectiveEnd) {
    updated = await db.transaction(async (tx) => {
      // Re-verify trip dates inside transaction to prevent TOCTOU
      const current = await tx.query.trips.findFirst({
        where: eq(trips.id, tripId),
        columns: { startDate: true, endDate: true },
      });
      if (
        current?.startDate !== currentTrip.startDate ||
        current?.endDate !== currentTrip.endDate
      ) {
        return null;
      }
      await syncTripDays(tx, tripId, effectiveStart, effectiveEnd);
      const [result] = await tx
        .update(trips)
        .set({ ...updatePayload, updatedAt: new Date() })
        .where(eq(trips.id, tripId))
        .returning();
      return result;
    });

    if (!updated) {
      return c.json({ error: ERROR_MSG.CONFLICT }, 409);
    }
  } else {
    const [result] = await db
      .update(trips)
      .set({ ...updatePayload, updatedAt: new Date() })
      .where(eq(trips.id, tripId))
      .returning();
    updated = result;

    if (!updated) {
      return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
    }
  }

  logActivity({
    tripId,
    userId: user.id,
    action: "updated",
    entityType: "trip",
    entityName: updated.title,
    detail: updatePayload.status ? `ステータス: ${STATUS_LABELS[updatePayload.status]}` : undefined,
  });

  return c.json(updated);
});

// Duplicate trip (any member can duplicate, new trip is owned by current user)
tripRoutes.post("/:id/duplicate", requireTripAccess("viewer", "id"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "id");

  if (user.isAnonymous) {
    return c.json({ error: ERROR_MSG.GUEST_TRIP_LIMIT }, 403);
  }

  const source = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    with: {
      days: {
        orderBy: (days, { asc }) => [asc(days.dayNumber)],
        with: {
          patterns: {
            orderBy: (patterns, { asc }) => [asc(patterns.sortOrder)],
            with: {
              schedules: {
                orderBy: (schedules, { asc }) => [asc(schedules.sortOrder)],
              },
            },
          },
        },
      },
    },
  });
  if (!source) {
    return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
  }

  let newTrip = await db.transaction(async (tx) => {
    const [tripCount] = await tx
      .select({ count: count() })
      .from(trips)
      .where(eq(trips.ownerId, user.id));
    const limit = user.isAnonymous ? 1 : await resolveTripLimit(tx, user.id);
    if (tripCount.count >= limit) {
      return null;
    }

    const [created] = await tx
      .insert(trips)
      .values({
        ownerId: user.id,
        title: `${source.title} (copy)`,
        destination: source.destination,
        startDate: source.startDate,
        endDate: source.endDate,
        status: source.status === "scheduling" ? "scheduling" : "draft",
        coverImagePosition: source.coverImagePosition,
        currency: source.currency ?? "JPY",
      })
      .returning();

    if (source.status === "scheduling") {
      const sourcePoll = await tx.query.schedulePolls.findFirst({
        where: eq(schedulePolls.tripId, source.id),
        with: {
          options: { orderBy: (o, { asc }) => [asc(o.sortOrder)] },
          participants: true,
        },
      });

      if (!sourcePoll) {
        logger.warn({ tripId: source.id }, "Scheduling trip has no poll, skipping poll copy");
      } else {
        const [newPoll] = await tx
          .insert(schedulePolls)
          .values({
            tripId: created.id,
            note: sourcePoll.note,
            deadline: sourcePoll.deadline,
          })
          .returning();

        if (sourcePoll.options.length > 0) {
          await tx.insert(schedulePollOptions).values(
            sourcePoll.options.map((opt) => ({
              pollId: newPoll.id,
              startDate: opt.startDate,
              endDate: opt.endDate,
              sortOrder: opt.sortOrder,
            })),
          );
        }

        if (sourcePoll.participants.length > 0) {
          await tx.insert(schedulePollParticipants).values(
            sourcePoll.participants.map((p) => ({
              pollId: newPoll.id,
              userId: p.userId,
            })),
          );
        }
      }
    } else {
      for (const day of source.days) {
        const [newDay] = await tx
          .insert(tripDays)
          .values({
            tripId: created.id,
            date: day.date,
            dayNumber: day.dayNumber,
          })
          .returning({ id: tripDays.id });

        for (const pattern of day.patterns) {
          const [newPattern] = await tx
            .insert(dayPatterns)
            .values({
              tripDayId: newDay.id,
              label: pattern.label,
              isDefault: pattern.isDefault,
              sortOrder: pattern.sortOrder,
            })
            .returning({ id: dayPatterns.id });

          if (pattern.schedules.length > 0) {
            await tx.insert(schedules).values(
              pattern.schedules.map((schedule) => ({
                tripId: created.id,
                dayPatternId: newPattern.id,
                ...buildScheduleCloneValues(schedule),
              })),
            );
          }
        }
      }
    }

    await tx.insert(tripMembers).values({
      tripId: created.id,
      userId: user.id,
      role: "owner" as const,
    });

    return created;
  });

  if (!newTrip) {
    return c.json({ error: ERROR_MSG.LIMIT_TRIPS }, 409);
  }

  // Copy cover image file in Storage (outside transaction to avoid holding locks)
  if (source.coverImageUrl) {
    const copiedUrl = await copyCoverImage(source.coverImageUrl, newTrip.id);
    if (copiedUrl) {
      await db.update(trips).set({ coverImageUrl: copiedUrl }).where(eq(trips.id, newTrip.id));
      newTrip = { ...newTrip, coverImageUrl: copiedUrl };
    }
  }

  logActivity({
    tripId: newTrip.id,
    userId: user.id,
    action: "duplicated",
    entityType: "trip",
    entityName: newTrip.title,
  });

  return c.json(newTrip, 201);
});

// Upload cover image (editor+)
tripRoutes.post("/:id/cover-image", requireTripAccess("editor", "id"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "id");

  const body = await c.req.parseBody();
  const file = body.file;

  if (!(file instanceof File)) {
    return c.json({ error: ERROR_MSG.FILE_REQUIRED }, 400);
  }

  const validationError = validateCoverImage(file);
  if (validationError) {
    return c.json({ error: validationError }, 400);
  }

  const currentTrip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    columns: { coverImageUrl: true },
  });

  if (currentTrip?.coverImageUrl) {
    await deleteCoverImage(currentTrip.coverImageUrl);
  }

  let coverImageUrl: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    coverImageUrl = await uploadCoverImage(tripId, buffer, file.type);
  } catch (err) {
    logger.error(
      { err, tripId, userId: user.id, fileSize: file.size, fileType: file.type },
      "Cover image upload failed",
    );
    return c.json({ error: ERROR_MSG.INTERNAL_ERROR }, 500);
  }

  const [updated] = await db
    .update(trips)
    .set({ coverImageUrl, updatedAt: new Date() })
    .where(eq(trips.id, tripId))
    .returning();

  return c.json({ coverImageUrl: updated.coverImageUrl });
});

// Delete cover image (editor+)
tripRoutes.delete("/:id/cover-image", requireTripAccess("editor", "id"), async (c) => {
  const tripId = getParam(c, "id");

  const currentTrip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    columns: { coverImageUrl: true },
  });

  if (currentTrip?.coverImageUrl) {
    await deleteCoverImage(currentTrip.coverImageUrl);
  }

  await db
    .update(trips)
    .set({ coverImageUrl: null, updatedAt: new Date() })
    .where(eq(trips.id, tripId));

  return c.json({ ok: true });
});

// Delete trip (owner only)
tripRoutes.delete("/:id", requireTripAccess("owner", "id"), async (c) => {
  const tripId = getParam(c, "id");

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    columns: { coverImageUrl: true },
  });

  if (trip?.coverImageUrl) {
    await deleteCoverImage(trip.coverImageUrl);
  }

  await db.delete(trips).where(eq(trips.id, tripId));
  return c.json({ ok: true });
});

export { tripRoutes };
