import { deleteAccountSchema, ValidationError } from "@sugara/shared";
import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { accounts, users } from "../db/schema";
import { ERROR_MSG, RATE_LIMIT_ACCOUNT_MUTATION } from "../lib/constants";
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

  if (!account || !account.password) {
    return c.json({ error: ERROR_MSG.ACCOUNT_NOT_FOUND }, 404);
  }

  const valid = await verifyPassword({
    password: parsed.data.password,
    hash: account.password,
  });

  if (!valid) {
    return c.json({ error: ERROR_MSG.INVALID_PASSWORD }, 401);
  }

  await db.delete(users).where(eq(users.id, user.id));

  return c.body(null, 204);
});
