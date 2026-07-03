import {
  createQuickPollSchema,
  MAX_QUICK_POLLS_PER_USER,
  updateQuickPollSchema,
} from "@sugara/shared";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { quickPollOptions, quickPolls } from "../db/schema";
import { ERROR_MSG, SEVEN_DAYS_MS } from "../lib/constants";
import { getParam } from "../lib/params";
import { generateShareToken } from "../lib/share-token";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

const quickPollRoutes = new Hono<AppEnv>();
quickPollRoutes.use("*", requireAuth);

// Create
quickPollRoutes.post("/", async (c) => {
  const user = c.get("user");
  const parsed = createQuickPollSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const { question, options, allowMultiple, showResultsBeforeVote } = parsed.data;

  // Check limit
  const existing = await db.query.quickPolls.findMany({
    where: eq(quickPolls.creatorId, user.id),
    columns: { id: true },
  });
  if (existing.length >= MAX_QUICK_POLLS_PER_USER) {
    return c.json({ error: ERROR_MSG.LIMIT_QUICK_POLLS }, 409);
  }

  // Atomic: a failed options insert must not leave an orphaned poll whose
  // share link opens an empty vote.
  const poll = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(quickPolls)
      .values({
        creatorId: user.id,
        shareToken: generateShareToken(),
        question,
        allowMultiple,
        showResultsBeforeVote,
        expiresAt: new Date(Date.now() + SEVEN_DAYS_MS),
      })
      .returning({ id: quickPolls.id, shareToken: quickPolls.shareToken });

    await tx.insert(quickPollOptions).values(
      options.map((opt, i) => ({
        pollId: created.id,
        label: opt.label,
        sortOrder: i,
      })),
    );

    return created;
  });

  return c.json({ id: poll.id, shareToken: poll.shareToken }, 201);
});

// List my polls
quickPollRoutes.get("/", async (c) => {
  const user = c.get("user");
  const polls = await db.query.quickPolls.findMany({
    where: eq(quickPolls.creatorId, user.id),
    orderBy: (p, { desc }) => [desc(p.createdAt)],
    with: {
      options: { orderBy: (o, { asc }) => [asc(o.sortOrder)] },
      votes: { columns: { id: true, optionId: true } },
    },
  });

  return c.json(
    polls.map((p) => ({
      id: p.id,
      question: p.question,
      shareToken: p.shareToken,
      status: isExpired(p) ? "closed" : p.status,
      allowMultiple: p.allowMultiple,
      expiresAt: p.expiresAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      options: p.options.map((o) => ({
        id: o.id,
        label: o.label,
        voteCount: p.votes.filter((v) => v.optionId === o.id).length,
      })),
      totalVotes: new Set(p.votes.map((v) => v.id)).size,
    })),
  );
});

// Get detail (creator only)
quickPollRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "id");

  const poll = await db.query.quickPolls.findFirst({
    where: and(eq(quickPolls.id, pollId), eq(quickPolls.creatorId, user.id)),
    with: {
      options: { orderBy: (o, { asc }) => [asc(o.sortOrder)] },
      votes: { columns: { id: true, optionId: true } },
    },
  });
  if (!poll) return c.json({ error: ERROR_MSG.QUICK_POLL_NOT_FOUND }, 404);

  return c.json({
    id: poll.id,
    question: poll.question,
    shareToken: poll.shareToken,
    status: isExpired(poll) ? "closed" : poll.status,
    allowMultiple: poll.allowMultiple,
    showResultsBeforeVote: poll.showResultsBeforeVote,
    expiresAt: poll.expiresAt.toISOString(),
    createdAt: poll.createdAt.toISOString(),
    options: poll.options.map((o) => ({
      id: o.id,
      label: o.label,
      voteCount: poll.votes.filter((v) => v.optionId === o.id).length,
    })),
    totalVotes: new Set(poll.votes.map((v) => v.id)).size,
  });
});

// Update (close)
quickPollRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "id");
  const parsed = updateQuickPollSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const poll = await db.query.quickPolls.findFirst({
    where: and(eq(quickPolls.id, pollId), eq(quickPolls.creatorId, user.id)),
  });
  if (!poll) return c.json({ error: ERROR_MSG.QUICK_POLL_NOT_FOUND }, 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.status === "closed") {
    updates.status = "closed";
    updates.closedAt = new Date();
  }

  const [updated] = await db
    .update(quickPolls)
    .set(updates)
    .where(eq(quickPolls.id, pollId))
    .returning({ id: quickPolls.id });

  return c.json(updated);
});

// Delete
quickPollRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const pollId = getParam(c, "id");

  const poll = await db.query.quickPolls.findFirst({
    where: and(eq(quickPolls.id, pollId), eq(quickPolls.creatorId, user.id)),
  });
  if (!poll) return c.json({ error: ERROR_MSG.QUICK_POLL_NOT_FOUND }, 404);

  await db.delete(quickPolls).where(eq(quickPolls.id, pollId));

  return c.body(null, 204);
});

function isExpired(poll: { expiresAt: Date; status: string }): boolean {
  return poll.status === "open" && poll.expiresAt < new Date();
}

export { quickPollRoutes };
