import {
  AppError,
  addMemberSchema,
  ERROR_CODE,
  MAX_MEMBERS_PER_TRIP,
  ROLE_LABELS,
  updateMemberRoleSchema,
} from "@sugara/shared";
import { and, count, eq, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { articles, articleTrips, expenseSplits, expenses, tripMembers, users } from "../db/schema";
import { logActivity } from "../lib/activity-logger";
import { ERROR_MSG } from "../lib/constants";
import { notifyArticleOwnersOnMemberAdded, notifyUsers } from "../lib/notifications";
import { getParam } from "../lib/params";
import { requireAuth } from "../middleware/auth";
import { requireTripAccess } from "../middleware/require-trip-access";
import type { AppEnv } from "../types";

const memberRoutes = new Hono<AppEnv>();
memberRoutes.use("*", requireAuth);

// List members (any member can view)
memberRoutes.get("/:tripId/members", requireTripAccess(), async (c) => {
  const tripId = getParam(c, "tripId");

  const members = await db.query.tripMembers.findMany({
    where: eq(tripMembers.tripId, tripId),
    with: { user: { columns: { id: true, name: true, image: true } } },
  });

  const memberIds = members.map((m) => m.userId);

  // Collect userIds that appear in expenses (as payer or in splits)
  const expenseUserIds = new Set<string>();
  if (memberIds.length > 0) {
    const rows = await db
      .select({
        paidByUserId: expenses.paidByUserId,
        splitUserId: expenseSplits.userId,
      })
      .from(expenses)
      .leftJoin(expenseSplits, eq(expenseSplits.expenseId, expenses.id))
      .where(
        and(
          eq(expenses.tripId, tripId),
          or(inArray(expenses.paidByUserId, memberIds), inArray(expenseSplits.userId, memberIds)),
        ),
      );
    for (const row of rows) {
      if (row.paidByUserId) expenseUserIds.add(row.paidByUserId);
      if (row.splitUserId) expenseUserIds.add(row.splitUserId);
    }
  }

  return c.json(
    members.map((m) => ({
      userId: m.userId,
      role: m.role,
      name: m.user.name,
      image: m.user.image,
      hasExpenses: expenseUserIds.has(m.userId),
    })),
  );
});

// Add member (owner only)
memberRoutes.post("/:tripId/members", requireTripAccess("owner"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, parsed.data.userId),
  });
  if (!targetUser) {
    return c.json({ error: ERROR_MSG.USER_NOT_FOUND }, 404);
  }

  await db.transaction(async (tx) => {
    const [[{ count: memberCount }], existing] = await Promise.all([
      tx.select({ count: count() }).from(tripMembers).where(eq(tripMembers.tripId, tripId)),
      tx.query.tripMembers.findFirst({
        where: and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, targetUser.id)),
      }),
    ]);
    if (memberCount >= MAX_MEMBERS_PER_TRIP) {
      throw new AppError(ERROR_MSG.LIMIT_MEMBERS, ERROR_CODE.LIMIT_MEMBERS, 409, {
        max: MAX_MEMBERS_PER_TRIP,
      });
    }
    if (existing) {
      throw new AppError(ERROR_MSG.ALREADY_MEMBER, ERROR_CODE.ALREADY_MEMBER, 409);
    }

    await tx.insert(tripMembers).values({
      tripId,
      userId: targetUser.id,
      role: parsed.data.role,
    });
  });

  logActivity({
    tripId,
    userId: user.id,
    action: "created",
    entityType: "member",
    entityName: targetUser.name,
    detail: parsed.data.role,
  });

  notifyUsers({
    type: "member_added",
    tripId,
    userIds: [targetUser.id],
    makePayload: (tripName) => ({ actorName: user.name, tripName }),
  });

  // C-2: notify owners of non-public articles linked to this trip that a new
  // member can now see their work.  Fire-and-forget; safe to run after commit.
  // excludeOwnerId suppresses self-notification when the actor (trip owner)
  // also has articles linked to this trip.
  void notifyArticleOwnersOnMemberAdded({
    tripId,
    addedUserIds: [targetUser.id],
    memberName: targetUser.name,
    excludeOwnerId: user.id,
  });

  return c.json(
    {
      userId: targetUser.id,
      role: parsed.data.role,
      name: targetUser.name,
    },
    201,
  );
});

// Update member role (owner only)
memberRoutes.patch("/:tripId/members/:userId", requireTripAccess("owner"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const targetUserId = getParam(c, "userId");

  if (targetUserId === user.id) {
    return c.json({ error: ERROR_MSG.CANNOT_CHANGE_OWN_ROLE }, 400);
  }

  const body = await c.req.json();
  const parsed = updateMemberRoleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.tripMembers.findFirst({
    where: and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, targetUserId)),
    with: { user: { columns: { name: true } } },
  });
  if (!existing) {
    return c.json({ error: ERROR_MSG.MEMBER_NOT_FOUND }, 404);
  }

  await db
    .update(tripMembers)
    .set({ role: parsed.data.role })
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, targetUserId)));

  logActivity({
    tripId,
    userId: user.id,
    action: "role_changed",
    entityType: "member",
    entityName: existing.user.name,
    detail: `${ROLE_LABELS[existing.role]} → ${ROLE_LABELS[parsed.data.role]}`,
  });

  notifyUsers({
    type: "role_changed",
    tripId,
    userIds: [targetUserId],
    makePayload: (tripName) => ({
      actorName: user.name,
      tripName,
      newRole: ROLE_LABELS[parsed.data.role],
    }),
  });

  return c.json({ ok: true });
});

// Remove member (owner only)
memberRoutes.delete("/:tripId/members/:userId", requireTripAccess("owner"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const targetUserId = getParam(c, "userId");

  if (targetUserId === user.id) {
    return c.json({ error: ERROR_MSG.CANNOT_REMOVE_SELF }, 400);
  }

  const existing = await db.query.tripMembers.findFirst({
    where: and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, targetUserId)),
    with: { user: { columns: { name: true } } },
  });
  if (!existing) {
    return c.json({ error: ERROR_MSG.MEMBER_NOT_FOUND }, 404);
  }

  // Check and delete atomically to prevent TOCTOU: a new expense could be added
  // between the check and the delete if not wrapped in a transaction.
  const deleted = await db.transaction(async (tx) => {
    const [{ count: expenseCount }] = await tx
      .select({ count: count() })
      .from(expenses)
      .leftJoin(expenseSplits, eq(expenseSplits.expenseId, expenses.id))
      .where(
        and(
          eq(expenses.tripId, tripId),
          or(eq(expenses.paidByUserId, targetUserId), eq(expenseSplits.userId, targetUserId)),
        ),
      );

    if (expenseCount > 0) return "has_expenses" as const;

    // C-3: remove article_trips links for articles authored by the departing
    // member so they are no longer visible to remaining trip members.
    const ownedArticleRows = await tx
      .select({ id: articles.id })
      .from(articles)
      .innerJoin(articleTrips, eq(articleTrips.articleId, articles.id))
      .where(and(eq(articles.ownerId, targetUserId), eq(articleTrips.tripId, tripId)));
    const ownedArticleIds = ownedArticleRows.map((r) => r.id);
    if (ownedArticleIds.length > 0) {
      await tx
        .delete(articleTrips)
        .where(
          and(eq(articleTrips.tripId, tripId), inArray(articleTrips.articleId, ownedArticleIds)),
        );
    }

    await tx
      .delete(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, targetUserId)));

    return "ok" as const;
  });

  if (deleted === "has_expenses") {
    return c.json({ error: ERROR_MSG.MEMBER_HAS_EXPENSES }, 409);
  }

  logActivity({
    tripId,
    userId: user.id,
    action: "deleted",
    entityType: "member",
    entityName: existing.user.name,
  });

  notifyUsers({
    type: "member_removed",
    tripId,
    userIds: [targetUserId],
    makePayload: (tripName) => ({ actorName: user.name, tripName }),
  });

  return c.json({ ok: true });
});

export { memberRoutes };
