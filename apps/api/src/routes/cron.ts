import { timingSafeEqual } from "node:crypto";
import { ERROR_MSG } from "@sugara/shared";
import { Hono } from "hono";
import { deleteExpiredGuests } from "../lib/cleanup-guests";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import { getRedis } from "../lib/redis";
import { refreshAllWeather, WEATHER_REFRESH_BUDGET_MS } from "../lib/weather-refresh";

export const cronRoutes = new Hono();

// Best-effort distributed lock so an overlapping invocation (e.g. a Vercel
// retry) does not start a second 58-office refresh on top of a live one. The
// TTL sits above the route's maxDuration (60s) so a crashed run self-clears.
const WEATHER_LOCK_KEY = "cron:refresh-weather:lock";
const WEATHER_LOCK_TTL_SECONDS = 90;

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

  // Acquire the lock before doing any work. No Redis (local/dev) -> proceed
  // unlocked. Redis errors fail open: a cache outage must not stop the daily
  // refresh, the per-office upsert is idempotent, and the worst case is a
  // redundant run rather than corruption.
  const redis = getRedis();
  let locked = false;
  if (redis) {
    try {
      locked =
        (await redis.set(WEATHER_LOCK_KEY, "1", { nx: true, ex: WEATHER_LOCK_TTL_SECONDS })) !==
        null;
      if (!locked) {
        logger.info("cron: weather refresh already running; skipping");
        return c.json({ locked: true }, 200);
      }
    } catch (err) {
      logger.error({ err }, "cron: weather lock acquire failed; proceeding without lock");
    }
  }

  // Always return 200, even on unexpected failure, so Vercel Cron does not
  // retry-storm a transient outage into overlapping runs.
  try {
    // onlyStale so a re-run (or the admin button) converges on the leftovers;
    // deadline keeps the run inside the route's maxDuration (60s), leaving any
    // unprocessed offices stale for the next run.
    const result = await refreshAllWeather({
      onlyStale: true,
      deadlineMs: Date.now() + WEATHER_REFRESH_BUDGET_MS,
    });
    return c.json(result, 200);
  } catch (err) {
    logger.error({ err }, "cron: weather refresh threw unexpectedly");
    return c.json({ error: "weather refresh failed" }, 200);
  } finally {
    if (locked && redis) {
      try {
        await redis.del(WEATHER_LOCK_KEY);
      } catch (err) {
        logger.error({ err }, "cron: weather lock release failed (will expire via TTL)");
      }
    }
  }
});
