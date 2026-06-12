import {
  AppError,
  addGroupMemberSchema,
  addGroupMembersBulkSchema,
  createGroupSchema,
  ERROR_CODE,
  MAX_GROUPS_PER_USER,
  MAX_MEMBERS_PER_GROUP,
  updateGroupSchema,
} from "@sugara/shared";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { groupMembers, groups, users } from "../db/schema";
import { ERROR_MSG, PG_UNIQUE_VIOLATION } from "../lib/constants";
import { hasChanges } from "../lib/has-changes";
import { getParam } from "../lib/params";
import { requireAuth } from "../middleware/auth";
import { requireNonGuest } from "../middleware/require-non-guest";
import type { AppEnv } from "../types";

const groupRoutes = new Hono<AppEnv>();
groupRoutes.use("*", requireAuth);
groupRoutes.use("*", requireNonGuest);

const groupReturning = {
  id: groups.id,
  name: groups.name,
  createdAt: groups.createdAt,
  updatedAt: groups.updatedAt,
} as const;

async function verifyGroupOwnership(groupId: string, userId: string) {
  const group = await db.query.groups.findFirst({
    where: and(eq(groups.id, groupId), eq(groups.ownerId, userId)),
  });
  return group ?? null;
}

// List owned groups with member count
groupRoutes.get("/", async (c) => {
  const user = c.get("user");

  const records = await db.query.groups.findMany({
    where: eq(groups.ownerId, user.id),
    orderBy: asc(groups.createdAt),
    with: {
      members: { columns: { userId: true } },
    },
  });

  return c.json(
    records.map((g) => ({
      id: g.id,
      name: g.name,
      memberCount: g.members.length,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })),
  );
});

// Create group
groupRoutes.post("/", async (c) => {
  const user = c.get("user");

  const body = await c.req.json();
  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const created = await db.transaction(async (tx) => {
    const [{ count: groupCount }] = await tx
      .select({ count: count() })
      .from(groups)
      .where(eq(groups.ownerId, user.id));
    if (groupCount >= MAX_GROUPS_PER_USER) {
      return null;
    }

    const [result] = await tx
      .insert(groups)
      .values({ ownerId: user.id, name: parsed.data.name })
      .returning(groupReturning);

    return result;
  });

  if (!created) {
    return c.json({ error: ERROR_MSG.LIMIT_GROUPS }, 409);
  }

  return c.json({ ...created, memberCount: 0 }, 201);
});

// Update group name
groupRoutes.patch("/:groupId", async (c) => {
  const user = c.get("user");
  const groupId = getParam(c, "groupId");

  const group = await verifyGroupOwnership(groupId, user.id);
  if (!group) {
    return c.json({ error: ERROR_MSG.GROUP_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = updateGroupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  if (!hasChanges(group, parsed.data)) {
    return c.json({
      id: group.id,
      name: group.name,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    });
  }

  const [updated] = await db
    .update(groups)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(eq(groups.id, groupId))
    .returning(groupReturning);

  return c.json(updated);
});

// Delete group
groupRoutes.delete("/:groupId", async (c) => {
  const user = c.get("user");
  const groupId = getParam(c, "groupId");

  const group = await verifyGroupOwnership(groupId, user.id);
  if (!group) {
    return c.json({ error: ERROR_MSG.GROUP_NOT_FOUND }, 404);
  }

  await db.delete(groups).where(eq(groups.id, groupId));

  return c.json({ ok: true });
});

// List group members
groupRoutes.get("/:groupId/members", async (c) => {
  const user = c.get("user");
  const groupId = getParam(c, "groupId");

  const group = await db.query.groups.findFirst({
    where: and(eq(groups.id, groupId), eq(groups.ownerId, user.id)),
    with: {
      members: {
        with: {
          user: { columns: { id: true, name: true, image: true } },
        },
      },
    },
  });
  if (!group) {
    return c.json({ error: ERROR_MSG.GROUP_NOT_FOUND }, 404);
  }

  return c.json(
    group.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      image: m.user.image,
      addedAt: m.addedAt,
    })),
  );
});

// Add member to group
groupRoutes.post("/:groupId/members", async (c) => {
  const user = c.get("user");
  const groupId = getParam(c, "groupId");

  const group = await verifyGroupOwnership(groupId, user.id);
  if (!group) {
    return c.json({ error: ERROR_MSG.GROUP_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = addGroupMemberSchema.safeParse(body);
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
    const [{ count: memberCount }] = await tx
      .select({ count: count() })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    if (memberCount >= MAX_MEMBERS_PER_GROUP) {
      throw new AppError(ERROR_MSG.LIMIT_GROUP_MEMBERS, ERROR_CODE.LIMIT_GROUP_MEMBERS, 409, {
        max: MAX_MEMBERS_PER_GROUP,
      });
    }

    try {
      await tx.insert(groupMembers).values({
        groupId,
        userId: parsed.data.userId,
      });
    } catch (e) {
      if (e instanceof Error && "code" in e && e.code === PG_UNIQUE_VIOLATION) {
        throw new AppError(ERROR_MSG.ALREADY_GROUP_MEMBER, ERROR_CODE.ALREADY_GROUP_MEMBER, 409);
      }
      throw e;
    }
  });

  return c.json({ ok: true }, 201);
});

// Bulk add members to group
groupRoutes.post("/:groupId/members/bulk", async (c) => {
  const user = c.get("user");
  const groupId = getParam(c, "groupId");

  const group = await verifyGroupOwnership(groupId, user.id);
  if (!group) {
    return c.json({ error: ERROR_MSG.GROUP_NOT_FOUND }, 404);
  }

  const body = await c.req.json();
  const parsed = addGroupMembersBulkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { userIds } = parsed.data;

  const result = await db.transaction(async (tx) => {
    const [{ count: currentCount }] = await tx
      .select({ count: count() })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));

    const remainingSlots = MAX_MEMBERS_PER_GROUP - currentCount;
    if (remainingSlots <= 0) {
      throw new AppError(ERROR_MSG.LIMIT_GROUP_MEMBERS, ERROR_CODE.LIMIT_GROUP_MEMBERS, 409, {
        max: MAX_MEMBERS_PER_GROUP,
      });
    }

    const existingMembers = await tx
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, groupId));
    const existingMemberIds = new Set(existingMembers.map((m) => m.userId));

    const newUserIds = userIds.filter((id) => !existingMemberIds.has(id));

    let validUserIds = new Set<string>();
    if (newUserIds.length > 0) {
      const existingUsers = await tx
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, newUserIds));
      validUserIds = new Set(existingUsers.map((u) => u.id));
    }

    const toAdd = newUserIds.filter((id) => validUserIds.has(id)).slice(0, remainingSlots);

    if (toAdd.length > 0) {
      await tx.insert(groupMembers).values(toAdd.map((uid) => ({ groupId, userId: uid })));
    }

    return { added: toAdd.length, failed: userIds.length - toAdd.length };
  });

  return c.json({ added: result.added, failed: result.failed }, 201);
});

// Remove member from group
groupRoutes.delete("/:groupId/members/:userId", async (c) => {
  const user = c.get("user");
  const groupId = getParam(c, "groupId");
  const targetUserId = getParam(c, "userId");

  const group = await verifyGroupOwnership(groupId, user.id);
  if (!group) {
    return c.json({ error: ERROR_MSG.GROUP_NOT_FOUND }, 404);
  }

  const existing = await db.query.groupMembers.findFirst({
    where: and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)),
  });
  if (!existing) {
    return c.json({ error: ERROR_MSG.GROUP_MEMBER_NOT_FOUND }, 404);
  }

  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));

  return c.json({ ok: true });
});

export { groupRoutes };
