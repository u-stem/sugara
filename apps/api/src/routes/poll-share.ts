import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { schedulePolls } from "../db/schema";
import { ERROR_MSG, RATE_LIMIT_PUBLIC_RESOURCE } from "../lib/constants";
import { getParam } from "../lib/params";
import { rateLimitByIp } from "../middleware/rate-limit";

const pollShareRoutes = new Hono();

const sharedPollRateLimit = rateLimitByIp(RATE_LIMIT_PUBLIC_RESOURCE);

// Get shared poll (no auth)
pollShareRoutes.get("/api/shared/polls/:token", sharedPollRateLimit, async (c) => {
  const token = getParam(c, "token");

  const poll = await db.query.schedulePolls.findFirst({
    where: eq(schedulePolls.shareToken, token),
    with: {
      trip: { columns: { title: true, destination: true } },
      options: { orderBy: (o, { asc }) => [asc(o.sortOrder)] },
      participants: {
        with: {
          user: { columns: { id: true, name: true, image: true } },
          responses: true,
        },
      },
    },
  });

  if (!poll) return c.json({ error: ERROR_MSG.POLL_SHARED_NOT_FOUND }, 404);

  // A missing expiry means a legacy link issued before expiry existed: treat it as revoked.
  // The owner can reissue it (POST/PUT /api/polls/:pollId/share) to get an expiring link.
  if (!poll.shareTokenExpiresAt || poll.shareTokenExpiresAt < new Date()) {
    return c.json({ error: ERROR_MSG.POLL_SHARED_NOT_FOUND }, 404);
  }

  c.header("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return c.json({
    id: poll.id,
    title: poll.trip.title,
    destination: poll.trip.destination,
    note: poll.note,
    status: poll.status,
    deadline: poll.deadline?.toISOString() ?? null,
    confirmedOptionId: poll.confirmedOptionId,
    shareExpiresAt: poll.shareTokenExpiresAt?.toISOString() ?? null,
    options: poll.options.map((o) => ({
      id: o.id,
      startDate: o.startDate,
      endDate: o.endDate,
      sortOrder: o.sortOrder,
    })),
    participants: poll.participants.map((p) => ({
      id: p.id,
      name: p.user?.name ?? "Unknown user",
      image: p.user?.image ?? null,
      responses: p.responses.map((r) => ({
        optionId: r.optionId,
        response: r.response,
      })),
    })),
    createdAt: poll.createdAt.toISOString(),
    updatedAt: poll.updatedAt.toISOString(),
  });
});

export { pollShareRoutes };
