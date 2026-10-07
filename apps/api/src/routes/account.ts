import { deleteAccountSchema, ValidationError } from "@sugara/shared";
import { verifyPassword } from "better-auth/crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { accounts, trips, users } from "../db/schema";
import { ERROR_MSG, RATE_LIMIT_ACCOUNT_MUTATION } from "../lib/constants";
import { deleteCoverImages } from "../lib/storage";
import { requireAuth } from "../middleware/auth";
import { rateLimitByIp } from "../middleware/rate-limit";
import type { AppEnv } from "../types";

export const accountRoutes = new Hono<AppEnv>();

const deleteRateLimit = rateLimitByIp(RATE_LIMIT_ACCOUNT_MUTATION);

accountRoutes.delete("/account", deleteRateLimit, requireAuth, async (c) => {
  const json = await c.req.json();
  const parsed = deleteAccountSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0].message);
  }

  const user = c.get("user");

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")),
    columns: { password: true },
  });

  if (!account?.password) {
    return c.json({ error: ERROR_MSG.ACCOUNT_NOT_FOUND }, 404);
  }

  const valid = await verifyPassword({
    password: parsed.data.password,
    hash: account.password,
  });

  if (!valid) {
    return c.json({ error: ERROR_MSG.INVALID_PASSWORD }, 401);
  }

  // Collect cover URLs before the delete: the trips rows (and their URLs) disappear
  // through the trips.owner_id cascade, after which Storage objects would be orphaned.
  const ownedCovers = await db.query.trips.findMany({
    where: and(eq(trips.ownerId, user.id), isNotNull(trips.coverImageUrl)),
    columns: { coverImageUrl: true },
  });

  await db.delete(users).where(eq(users.id, user.id));

  // Storage is cleaned only after the DB delete succeeded and is best-effort: the
  // account deletion the user asked for must not fail or roll back because Storage
  // is unavailable, and leftover objects are reclaimed by the
  // `db:cleanup-orphan-covers` sweep. The reverse order could delete images of an
  // account that then fails to delete.
  await deleteCoverImages(ownedCovers.flatMap((t) => (t.coverImageUrl ? [t.coverImageUrl] : [])));

  return c.body(null, 204);
});
