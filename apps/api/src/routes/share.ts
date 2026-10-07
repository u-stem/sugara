import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { trips } from "../db/schema";
import { ERROR_MSG, RATE_LIMIT_PUBLIC_RESOURCE } from "../lib/constants";
import { getParam } from "../lib/params";
import { generateShareToken, shareExpiresAt } from "../lib/share-token";
import { toSharedTripResponse } from "../lib/shared-trip-view";
import { requireAuth } from "../middleware/auth";
import { rateLimitByIp } from "../middleware/rate-limit";
import { requireNonGuest } from "../middleware/require-non-guest";
import { requireTripAccess } from "../middleware/require-trip-access";
import type { AppEnv } from "../types";

const shareRoutes = new Hono<AppEnv>();

const sharedTripRateLimit = rateLimitByIp(RATE_LIMIT_PUBLIC_RESOURCE);

// Generate or get share link (owner only)
shareRoutes.post(
  "/api/trips/:id/share",
  requireAuth,
  requireNonGuest,
  requireTripAccess("owner", "id"),
  async (c) => {
    const tripId = getParam(c, "id");

    const trip = await db.query.trips.findFirst({
      where: eq(trips.id, tripId),
      columns: { shareToken: true, shareTokenExpiresAt: true },
    });

    const now = new Date();
    const activeShareTokenExpiresAt = trip?.shareTokenExpiresAt;
    const activeShareToken =
      trip?.shareToken && activeShareTokenExpiresAt && activeShareTokenExpiresAt >= now;

    if (activeShareToken) {
      return c.json({
        shareToken: trip.shareToken,
        shareTokenExpiresAt: activeShareTokenExpiresAt.toISOString(),
      });
    }

    // Generate new token (or replace expired / legacy one)
    const expiresAt = shareExpiresAt();
    // Use the current token value in WHERE to prevent overwriting a token
    // that another concurrent request may have already set.
    const whereCondition = trip?.shareToken
      ? and(eq(trips.id, tripId), eq(trips.shareToken, trip.shareToken))
      : and(eq(trips.id, tripId), isNull(trips.shareToken));
    const [updated] = await db
      .update(trips)
      .set({ shareToken: generateShareToken(), shareTokenExpiresAt: expiresAt })
      .where(whereCondition)
      .returning({ shareToken: trips.shareToken, shareTokenExpiresAt: trips.shareTokenExpiresAt });

    // If another request already set the token, fetch the existing one
    if (!updated) {
      const refreshed = await db.query.trips.findFirst({
        where: eq(trips.id, tripId),
        columns: { shareToken: true, shareTokenExpiresAt: true },
      });
      if (!refreshed?.shareToken) {
        return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
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
  },
);

// Regenerate share link (owner only)
shareRoutes.put(
  "/api/trips/:id/share",
  requireAuth,
  requireNonGuest,
  requireTripAccess("owner", "id"),
  async (c) => {
    const tripId = getParam(c, "id");

    const expiresAt = shareExpiresAt();
    const [updated] = await db
      .update(trips)
      .set({ shareToken: generateShareToken(), shareTokenExpiresAt: expiresAt })
      .where(eq(trips.id, tripId))
      .returning({ shareToken: trips.shareToken, shareTokenExpiresAt: trips.shareTokenExpiresAt });

    if (!updated) {
      return c.json({ error: ERROR_MSG.TRIP_NOT_FOUND }, 404);
    }

    return c.json({
      shareToken: updated.shareToken,
      shareTokenExpiresAt: updated.shareTokenExpiresAt?.toISOString() ?? null,
    });
  },
);

// View shared trip (no auth required)
shareRoutes.get("/api/shared/:token", sharedTripRateLimit, async (c) => {
  const token = getParam(c, "token");

  const trip = await db.query.trips.findFirst({
    where: eq(trips.shareToken, token),
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
      schedules: {
        orderBy: (schedules, { asc }) => [asc(schedules.sortOrder)],
      },
    },
  });

  if (!trip) {
    return c.json({ error: ERROR_MSG.SHARED_NOT_FOUND }, 404);
  }

  // A missing expiry means a legacy link issued before expiry existed: treat it as revoked.
  // The owner can reissue it (POST/PUT /share) to get an expiring link.
  if (!trip.shareTokenExpiresAt || trip.shareTokenExpiresAt <= new Date()) {
    return c.json({ error: ERROR_MSG.SHARED_NOT_FOUND }, 404);
  }

  c.header("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return c.json(toSharedTripResponse(trip, token));
});

export { shareRoutes };
