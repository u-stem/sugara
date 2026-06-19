import { timingSafeEqual } from "node:crypto";
import { ERROR_MSG } from "@sugara/shared";
import { Hono } from "hono";
import { deleteExpiredGuests } from "../lib/cleanup-guests";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { refreshAllWeather } from "../lib/weather-refresh";

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

// Refresh the nationwide weekly weather forecast once a day from JMA. Always
// returns 200 even on partial failure so Vercel Cron does not retry-storm; the
// per-office skip is logged inside refreshAllWeather.
cronRoutes.get("/cron/refresh-weather", async (c) => {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return c.json({ error: ERROR_MSG.CRON_NOT_CONFIGURED }, 503);
  }
  if (!bearerMatches(c.req.header("authorization"), secret)) {
    return c.json({ error: ERROR_MSG.UNAUTHORIZED }, 401);
  }

  // Always return 200, even on unexpected failure, so Vercel Cron does not
  // retry-storm a transient outage into overlapping runs.
  try {
    const result = await refreshAllWeather();
    return c.json(result, 200);
  } catch (err) {
    logger.error({ err }, "cron: weather refresh threw unexpectedly");
    return c.json({ error: "weather refresh failed" }, 200);
  }
});
