import { timingSafeEqual } from "node:crypto";
import { ERROR_MSG } from "@sugara/shared";
import { Hono } from "hono";
import { deleteExpiredGuests } from "../lib/cleanup-guests";
import { env } from "../lib/env";
import { logger } from "../lib/logger";

export const cronRoutes = new Hono();

function bearerMatches(header: string | undefined, secret: string): boolean {
  const prefix = "Bearer ";
  if (!header?.startsWith(prefix)) return false;
  const token = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  // timingSafeEqual throws on length mismatch, so guard length first.
  return token.length === expected.length && timingSafeEqual(token, expected);
}

// Vercel Cron hits this on a schedule (apps/web/vercel.json `crons`). No
// requireAuth: cron requests carry no session, so they are gated by the shared
// CRON_SECRET sent as `Authorization: Bearer <secret>` instead.
cronRoutes.get("/cron/cleanup-guests", async (c) => {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return c.json({ error: ERROR_MSG.CRON_NOT_CONFIGURED }, 503);
  }
  if (!bearerMatches(c.req.header("authorization"), secret)) {
    return c.json({ error: ERROR_MSG.UNAUTHORIZED }, 401);
  }

  const deleted = await deleteExpiredGuests();
  logger.info({ deleted }, "cron: expired guests cleaned up");
  return c.json({ deleted }, 200);
});
