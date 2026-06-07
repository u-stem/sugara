import {
  addPollOptionSchema,
  addPollParticipantSchema,
  confirmPollSchema,
  MAX_MEMBERS_PER_TRIP,
  MAX_OPTIONS_PER_POLL,
  MAX_PARTICIPANTS_PER_POLL,
  submitPollResponsesSchema,
  updatePollSchema,
} from "@sugara/shared";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  schedulePollOptions,
  schedulePollParticipants,
  schedulePollResponses,
  schedulePolls,
  tripMembers,
  trips,
  users,
} from "../db/schema";
import { formatShortDateRange, logActivity } from "../lib/activity-logger";
import { ERROR_MSG } from "../lib/constants";
import { hasChanges } from "../lib/has-changes";
import { logger } from "../lib/logger";
import { createNotification, notifyArticleOwnersOnMemberAdded } from "../lib/notifications";
import { getParam } from "../lib/params";
import { findPollAsEditor, findPollAsOwner, findPollAsParticipant } from "../lib/poll-access";
import { generateShareToken, shareExpiresAt } from "../lib/share-token";
import { createInitialTripDays } from "../lib/trip-days";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const pollRoutes = new Hono<AppEnv>();
pollRoutes.use("*", requireAuth);

function formatPollResponse(
  poll: {
    id: string;
    tripId: string;
    note: string | null;
    status: string;
    deadline: Date | null;
    confirmedOptionId: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  trip: { ownerId: string; title: string | null; destination: string | null },
) {
  return {
    id: poll.id,
    ownerId: trip.ownerId,
    title: trip.title,
    destination: trip.destination,
    note: poll.note,
    status: poll.status,
    deadline: poll.deadline?.toISOString() ?? null,
    confirmedOptionId: poll.confirmedOptionId,
    tripId: poll.tripId,
    createdAt: poll.createdAt.toISOString(),
    updatedAt: poll.updatedAt.toISOString(),
  };
}

// List polls (owned or participant)
pollRoutes.get("/", async (c) => {
  const user = c.get("user");

  const participantCountSql = sql<number>`(
    SELECT count(*) FROM schedule_poll_participants
    WHERE poll_id = ${schedulePolls.id}
  )`.as("participant_count");

  // Responses link to options, not directly to polls
  const respondedCountSql = sql<number>`(
    SELECT count(DISTINCT spr.participant_id) FROM schedule_poll_responses spr
    JOIN schedule_poll_options spo ON spr.option_id = spo.id
    WHERE spo.poll_id = ${schedulePolls.id}
  )`.as("responded_count");

  const pollSelectFields = {
    id: schedulePolls.id,
    title: trips.title,
    destination: trips.destination,
    status: schedulePolls.status,
    deadline: schedulePolls.deadline,
    createdAt: schedulePolls.createdAt,
    updatedAt: schedulePolls.updatedAt,
    participantCount: participantCountSql,
    respondedCount: respondedCountSql,
  };

  const [ownedPolls, participatingPolls] = await Promise.all([
    db
      .select(pollSelectFields)
      .from(schedulePolls)
      .innerJoin(trips, eq(schedulePolls.tripId, trips.id))
      .where(eq(trips.ownerId, user.id))
      .orderBy(desc(schedulePolls.updatedAt)),
    db
      .select(pollSelectFields)
      .from(schedulePollParticipants)
      .innerJoin(schedulePolls, eq(schedulePollParticipants.pollId, schedulePolls.id))
      .innerJoin(trips, eq(schedulePolls.tripId, trips.id))
      .where(and(eq(schedulePollParticipants.userId, user.id), sql`${trips.ownerId} != ${user.id}`))
      .orderBy(desc(schedulePolls.updatedAt)),
  ]);

  const allPolls = [...ownedPolls, ...participatingPolls].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return c.json(
    allPolls.map((p) => ({
      ...p,
      deadline: p.deadline?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      participantCount: Number(p.participantCount),
      respondedCount: Number(p.respondedCount),
    })),
  );
});

// Get poll detail
pollRoutes.get("/:pollId", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");

  const poll = await findPollAsParticipant(pollId, user.id);
  if (!poll) {
    return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);
  }

  const [options, participants] = await Promise.all([
    db.query.schedulePollOptions.findMany({
      where: eq(schedulePollOptions.pollId, pollId),
      orderBy: (o, { asc }) => [asc(o.sortOrder)],
    }),
    db.query.schedulePollParticipants.findMany({
      where: eq(schedulePollParticipants.pollId, pollId),
      with: {
        user: { columns: { id: true, name: true, image: true } },
        responses: true,
      },
    }),
  ]);

  const myParticipant = participants.find((p) => p.userId === user.id);

  return c.json({
    id: poll.id,
    ownerId: poll.trip.ownerId,
    title: poll.trip.title,
    destination: poll.trip.destination,
    note: poll.note,
    status: poll.status,
    deadline: poll.deadline?.toISOString() ?? null,
    confirmedOptionId: poll.confirmedOptionId,
    tripId: poll.tripId,
    options: options.map((o) => ({
      id: o.id,
      startDate: o.startDate,
      endDate: o.endDate,
      sortOrder: o.sortOrder,
    })),
    participants: participants.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user?.name ?? "Unknown user",
      image: p.user?.image ?? null,
      responses: p.responses.map((r) => ({
        optionId: r.optionId,
        response: r.response,
      })),
    })),
    isOwner: poll.trip.ownerId === user.id,
    myParticipantId: myParticipant?.id ?? null,
    createdAt: poll.createdAt.toISOString(),
    updatedAt: poll.updatedAt.toISOString(),
  });
});

// Update poll (owner: deadline, editor: note only, open only)
pollRoutes.patch("/:pollId", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");
  const body = await c.req.json();
  const parsed = updatePollSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const result = await findPollAsEditor(pollId, user.id);
  if (!result) {
    return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);
  }
  if (result.poll.status !== "open") {
    return c.json({ error: ERROR_MSG.POLL_NOT_OPEN }, 400);
  }

  const fieldUpdates: Record<string, unknown> = {};
  if (parsed.data.note !== undefined) fieldUpdates.note = parsed.data.note;
  if (result.isOwner && parsed.data.deadline !== undefined) {
    fieldUpdates.deadline = parsed.data.deadline ? new Date(parsed.data.deadline) : null;
  }

  const poll = result.poll;

  if (!hasChanges(poll, fieldUpdates)) {
    const trip = await db.query.trips.findFirst({
      where: eq(trips.id, poll.tripId),
      columns: { ownerId: true, title: true, destination: true },
    });
    if (!trip) return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
    return c.json(formatPollResponse(poll, trip));
  }

  const [updated] = await db
    .update(schedulePolls)
    .set({ ...fieldUpdates, updatedAt: new Date() })
    .where(eq(schedulePolls.id, pollId))
    .returning();

  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, updated.tripId),
    columns: { ownerId: true, title: true, destination: true },
  });
  if (!trip) return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);

  return c.json(formatPollResponse(updated, trip));
});

// Delete poll (owner only)
pollRoutes.delete("/:pollId", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");

  const poll = await findPollAsOwner(pollId, user.id);
  if (!poll) {
    return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);
  }

  await db.transaction(async (tx) => {
    const trip = await tx.query.trips.findFirst({
      where: eq(trips.id, poll.tripId),
      columns: { id: true, status: true },
    });
    if (trip?.status === "scheduling") {
      // CASCADE deletes the poll
      await tx.delete(trips).where(eq(trips.id, trip.id));
    } else {
      await tx.delete(schedulePolls).where(eq(schedulePolls.id, pollId));
    }
  });

  return c.json({ ok: true });
});

// Add option (owner only, open only)
pollRoutes.post("/:pollId/options", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");
  const body = await c.req.json();
  const parsed = addPollOptionSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const poll = await findPollAsOwner(pollId, user.id);
  if (!poll) return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);
  if (poll.status !== "open") return c.json({ error: ERROR_MSG.POLL_NOT_OPEN }, 400);

  const [optionCount] = await db
    .select({ count: count() })
    .from(schedulePollOptions)
    .where(eq(schedulePollOptions.pollId, pollId));
  if (optionCount.count >= MAX_OPTIONS_PER_POLL) {
    return c.json({ error: ERROR_MSG.LIMIT_POLL_OPTIONS }, 409);
  }

  const [duplicate] = await db
    .select({ id: schedulePollOptions.id })
    .from(schedulePollOptions)
    .where(
      and(
        eq(schedulePollOptions.pollId, pollId),
        eq(schedulePollOptions.startDate, parsed.data.startDate),
        eq(schedulePollOptions.endDate, parsed.data.endDate),
      ),
    );
  if (duplicate) {
    return c.json({ error: ERROR_MSG.POLL_OPTION_DUPLICATE }, 409);
  }

  const [option] = await db
    .insert(schedulePollOptions)
    .values({
      pollId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      sortOrder: optionCount.count,
    })
    .returning();

  await db.update(schedulePolls).set({ updatedAt: new Date() }).where(eq(schedulePolls.id, pollId));

  logActivity({
    tripId: poll.tripId,
    userId: user.id,
    action: "option_added",
    entityType: "poll",
    entityName: formatShortDateRange(option.startDate, option.endDate),
  });

  return c.json(
    {
      id: option.id,
      startDate: option.startDate,
      endDate: option.endDate,
      sortOrder: option.sortOrder,
    },
    201,
  );
});

// Delete option (owner only, open only)
pollRoutes.delete("/:pollId/options/:optionId", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");
  const optionId = getParam(c, "optionId");

  const poll = await findPollAsOwner(pollId, user.id);
  if (!poll) return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);
  if (poll.status !== "open") return c.json({ error: ERROR_MSG.POLL_NOT_OPEN }, 400);

  const deleted = await db
    .delete(schedulePollOptions)
    .where(and(eq(schedulePollOptions.id, optionId), eq(schedulePollOptions.pollId, pollId)))
    .returning();
  if (deleted.length === 0) return c.json({ error: ERROR_MSG.POLL_OPTION_NOT_FOUND }, 404);

  await db.update(schedulePolls).set({ updatedAt: new Date() }).where(eq(schedulePolls.id, pollId));

  logActivity({
    tripId: poll.tripId,
    userId: user.id,
    action: "option_deleted",
    entityType: "poll",
    entityName: formatShortDateRange(deleted[0].startDate, deleted[0].endDate),
  });

  return c.json({ ok: true });
});

// Add participant (owner only)
pollRoutes.post("/:pollId/participants", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");
  const body = await c.req.json();
  const parsed = addPollParticipantSchema.safeParse(body);

  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const poll = await findPollAsOwner(pollId, user.id);
  if (!poll) return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);
  if (poll.status !== "open") return c.json({ error: ERROR_MSG.POLL_NOT_OPEN }, 400);

  const [participantCount] = await db
    .select({ count: count() })
    .from(schedulePollParticipants)
    .where(eq(schedulePollParticipants.pollId, pollId));
  if (participantCount.count >= MAX_PARTICIPANTS_PER_POLL) {
    return c.json({ error: ERROR_MSG.LIMIT_POLL_PARTICIPANTS }, 409);
  }

  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, parsed.data.userId),
    columns: { id: true, name: true, image: true },
  });
  if (!targetUser) return c.json({ error: ERROR_MSG.USER_NOT_FOUND }, 404);

  // Verify the target user is a trip member
  const isTripMember = await db.query.tripMembers.findFirst({
    where: and(eq(tripMembers.tripId, poll.tripId), eq(tripMembers.userId, parsed.data.userId)),
  });
  if (!isTripMember) return c.json({ error: ERROR_MSG.USER_NOT_FOUND }, 404);

  const existing = await db.query.schedulePollParticipants.findFirst({
    where: and(
      eq(schedulePollParticipants.pollId, pollId),
      eq(schedulePollParticipants.userId, parsed.data.userId),
    ),
  });
  if (existing) return c.json({ error: ERROR_MSG.POLL_ALREADY_PARTICIPANT }, 409);

  const [participant] = await db
    .insert(schedulePollParticipants)
    .values({ pollId, userId: parsed.data.userId })
    .returning();

  await db.update(schedulePolls).set({ updatedAt: new Date() }).where(eq(schedulePolls.id, pollId));

  void db.query.trips
    .findFirst({ where: eq(trips.id, poll.tripId), columns: { title: true } })
    .then((trip) => {
      void createNotification({
        type: "poll_started",
        userId: targetUser.id,
        tripId: poll.tripId,
        payload: { actorName: user.name, tripName: trip?.title ?? "旅行" },
      });
    });

  return c.json(
    {
      id: participant.id,
      userId: targetUser.id,
      name: targetUser.name,
      image: targetUser.image,
      responses: [],
    },
    201,
  );
});

// Delete participant (owner only)
pollRoutes.delete("/:pollId/participants/:participantId", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");
  const participantId = getParam(c, "participantId");

  const poll = await findPollAsOwner(pollId, user.id);
  if (!poll) return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);

  const target = await db.query.schedulePollParticipants.findFirst({
    where: and(
      eq(schedulePollParticipants.id, participantId),
      eq(schedulePollParticipants.pollId, pollId),
    ),
  });
  if (!target) return c.json({ error: ERROR_MSG.POLL_PARTICIPANT_NOT_FOUND }, 404);
  if (target.userId === user.id) {
    return c.json({ error: ERROR_MSG.POLL_CANNOT_REMOVE_OWNER }, 400);
  }

  await db.delete(schedulePollParticipants).where(eq(schedulePollParticipants.id, participantId));

  await db.update(schedulePolls).set({ updatedAt: new Date() }).where(eq(schedulePolls.id, pollId));

  return c.json({ ok: true });
});

// Submit responses (participant only)
pollRoutes.put("/:pollId/responses", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");
  const body = await c.req.json();
  const parsed = submitPollResponsesSchema.safeParse(body);

  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const poll = await findPollAsParticipant(pollId, user.id);
  if (!poll) return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);
  if (poll.status !== "open") return c.json({ error: ERROR_MSG.POLL_NOT_OPEN }, 400);
  if (poll.deadline && poll.deadline < new Date()) {
    return c.json({ error: ERROR_MSG.POLL_DEADLINE_PASSED }, 400);
  }

  // findPollAsParticipant already fetches participants filtered by userId
  const participant = poll.participants[0];
  if (!participant) return c.json({ error: ERROR_MSG.POLL_PARTICIPANT_NOT_FOUND }, 404);

  // Validate all optionIds belong to this poll
  if (parsed.data.responses.length > 0) {
    const validOptionIds = await db.query.schedulePollOptions.findMany({
      where: eq(schedulePollOptions.pollId, pollId),
      columns: { id: true },
    });
    const validIds = new Set(validOptionIds.map((o) => o.id));
    const invalid = parsed.data.responses.some((r) => !validIds.has(r.optionId));
    if (invalid) return c.json({ error: ERROR_MSG.POLL_INVALID_OPTION }, 400);
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schedulePollResponses)
      .where(eq(schedulePollResponses.participantId, participant.id));

    if (parsed.data.responses.length > 0) {
      await tx.insert(schedulePollResponses).values(
        parsed.data.responses.map((r) => ({
          participantId: participant.id,
          optionId: r.optionId,
          response: r.response,
        })),
      );
    }
  });

  await db.update(schedulePolls).set({ updatedAt: new Date() }).where(eq(schedulePolls.id, pollId));

  return c.json({ ok: true });
});

// Generate or get share link (owner only)
pollRoutes.post("/:pollId/share", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");

  const poll = await findPollAsOwner(pollId, user.id);
  if (!poll) return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);

  const now = new Date();
  const activeShareTokenExpiresAt = poll.shareTokenExpiresAt;
  const activeShareToken =
    poll.shareToken && activeShareTokenExpiresAt && activeShareTokenExpiresAt >= now;

  if (activeShareToken) {
    return c.json({
      shareToken: poll.shareToken,
      shareTokenExpiresAt: activeShareTokenExpiresAt.toISOString(),
    });
  }

  // Generate new token (or replace expired / legacy one)
  const expiresAt = shareExpiresAt();
  const whereCondition = poll.shareToken
    ? and(eq(schedulePolls.id, pollId), eq(schedulePolls.shareToken, poll.shareToken))
    : and(eq(schedulePolls.id, pollId), isNull(schedulePolls.shareToken));
  const [updated] = await db
    .update(schedulePolls)
    .set({
      shareToken: generateShareToken(),
      shareTokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(whereCondition)
    .returning({
      shareToken: schedulePolls.shareToken,
      shareTokenExpiresAt: schedulePolls.shareTokenExpiresAt,
    });

  if (!updated) {
    const refreshed = await db.query.schedulePolls.findFirst({
      where: eq(schedulePolls.id, pollId),
      columns: { shareToken: true, shareTokenExpiresAt: true },
    });
    if (!refreshed?.shareToken) {
      return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);
    }
    return c.json({
      shareToken: refreshed.shareToken,
      shareTokenExpiresAt: refreshed.shareTokenExpiresAt?.toISOString() ?? null,
    });
  }

  return c.json({
    shareToken: updated.shareToken,
    shareTokenExpiresAt: updated.shareTokenExpiresAt?.toISOString() ?? null,
  });
});

// Regenerate share link (owner only)
pollRoutes.put("/:pollId/share", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");

  const poll = await findPollAsOwner(pollId, user.id);
  if (!poll) return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);

  const expiresAt = shareExpiresAt();
  const [updated] = await db
    .update(schedulePolls)
    .set({
      shareToken: generateShareToken(),
      shareTokenExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(schedulePolls.id, pollId))
    .returning({
      shareToken: schedulePolls.shareToken,
      shareTokenExpiresAt: schedulePolls.shareTokenExpiresAt,
    });

  if (!updated) return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);

  return c.json({
    shareToken: updated.shareToken,
    shareTokenExpiresAt: updated.shareTokenExpiresAt?.toISOString() ?? null,
  });
});

// Confirm poll and update trip (owner only)
pollRoutes.post("/:pollId/confirm", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "pollId");
  const body = await c.req.json();
  const parsed = confirmPollSchema.safeParse(body);

  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const poll = await findPollAsOwner(pollId, user.id);
  if (!poll) return c.json({ error: ERROR_MSG.POLL_NOT_FOUND }, 404);
  if (poll.status !== "open") return c.json({ error: ERROR_MSG.POLL_NOT_OPEN }, 400);

  const option = await db.query.schedulePollOptions.findFirst({
    where: and(
      eq(schedulePollOptions.id, parsed.data.optionId),
      eq(schedulePollOptions.pollId, pollId),
    ),
  });
  if (!option) return c.json({ error: ERROR_MSG.POLL_OPTION_NOT_FOUND }, 404);

  const tripId = poll.tripId;

  // Capture auto-joined user IDs outside the transaction so we can fire C-2
  // notifications after the transaction commits (fire-and-forget, non-blocking).
  let autoJoinedUserIds: string[] = [];

  const result = await db.transaction(async (tx) => {
    // Re-check status inside transaction to prevent double-confirm
    const currentPoll = await tx.query.schedulePolls.findFirst({
      where: eq(schedulePolls.id, pollId),
      columns: { status: true },
    });
    if (!currentPoll || currentPoll.status !== "open") {
      return "already_confirmed" as const;
    }

    // Update existing trip with confirmed dates
    await tx
      .update(trips)
      .set({
        startDate: option.startDate,
        endDate: option.endDate,
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(trips.id, tripId));

    await createInitialTripDays(tx, tripId, option.startDate, option.endDate);

    // Add poll participants who aren't already trip members
    const participants = await tx.query.schedulePollParticipants.findMany({
      where: eq(schedulePollParticipants.pollId, pollId),
    });
    const existingMembers = await tx.query.tripMembers.findMany({
      where: eq(tripMembers.tripId, tripId),
    });
    const existingUserIds = new Set(existingMembers.map((m) => m.userId));

    const newMembers = participants.filter((p) => !existingUserIds.has(p.userId));
    if (existingMembers.length + newMembers.length > MAX_MEMBERS_PER_TRIP) {
      return null;
    }
    if (newMembers.length > 0) {
      autoJoinedUserIds = newMembers.map((p) => p.userId);
      await tx.insert(tripMembers).values(
        newMembers.map((p) => ({
          tripId,
          userId: p.userId,
          role: "editor" as const,
        })),
      );
    }

    const [updatedPoll] = await tx
      .update(schedulePolls)
      .set({
        status: "confirmed",
        confirmedOptionId: option.id,
        updatedAt: new Date(),
      })
      .where(eq(schedulePolls.id, pollId))
      .returning();

    return updatedPoll;
  });

  if (result === "already_confirmed") {
    return c.json({ error: ERROR_MSG.POLL_NOT_OPEN }, 400);
  }
  if (!result) {
    return c.json({ error: ERROR_MSG.LIMIT_MEMBERS }, 409);
  }

  // C-2: notify article owners about members auto-joined via poll confirmation.
  // Fire-and-forget after transaction commit; no excludeOwnerId because notifying
  // the poll-confirmer about their own articles becoming visible is meaningful.
  if (autoJoinedUserIds.length > 0) {
    // Resolve the joined members' names so the notification body reads correctly
    // ("X joined") instead of an empty name. Multiple may join from one poll.
    const joined = await db.query.users.findMany({
      where: inArray(users.id, autoJoinedUserIds),
      columns: { name: true },
    });
    const memberName = joined.map((u) => u.name).join(", ");
    void notifyArticleOwnersOnMemberAdded({
      tripId,
      addedUserIds: autoJoinedUserIds,
      memberName,
    });
  }

  logActivity({
    tripId,
    userId: user.id,
    action: "confirmed",
    entityType: "poll",
    entityName: formatShortDateRange(option.startDate, option.endDate),
  });

  // Fetch trip data for response
  const trip = await db.query.trips.findFirst({
    where: eq(trips.id, tripId),
    columns: { ownerId: true, title: true, destination: true },
  });
  if (!trip) return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);

  const tripName = trip.title ?? "旅行";
  const confirmedDateRange = formatShortDateRange(option.startDate, option.endDate);
  void (async () => {
    const participants = await db.query.schedulePollParticipants.findMany({
      where: eq(schedulePollParticipants.pollId, pollId),
      columns: { userId: true },
    });
    await Promise.all(
      participants
        .filter((p) => p.userId !== user.id)
        .map((p) =>
          createNotification({
            type: "poll_closed",
            userId: p.userId,
            tripId,
            payload: { actorName: user.name, tripName, entityName: confirmedDateRange },
          }),
        ),
    );
  })().catch((err) => {
    logger.error({ err, pollId }, "Failed to notify poll participants of closure");
  });

  return c.json(formatPollResponse(result, trip));
});

export { pollRoutes };
