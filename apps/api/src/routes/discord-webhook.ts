import {
  buildDiscordEmbed,
  createDiscordWebhookSchema,
  maskWebhookUrl,
  updateDiscordWebhookSchema,
} from "@sugara/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { discordWebhooks } from "../db/schema";
import { ERROR_MSG, PG_UNIQUE_VIOLATION } from "../lib/constants";
import { validateWebhookUrl } from "../lib/discord";
import { env } from "../lib/env";
import { getParam } from "../lib/params";
import { requireAuth } from "../middleware/auth";
import { requireTripAccess } from "../middleware/require-trip-access";
import type { AppEnv } from "../types";

const discordWebhookRoutes = new Hono<AppEnv>();
discordWebhookRoutes.use("*", requireAuth);

// GET /:tripId/discord-webhook — viewer can see, returns masked URL
discordWebhookRoutes.get("/:tripId/discord-webhook", requireTripAccess(), async (c) => {
  const tripId = getParam(c, "tripId");

  const webhook = await db.query.discordWebhooks.findFirst({
    where: eq(discordWebhooks.tripId, tripId),
  });

  if (!webhook) {
    return c.json(null);
  }

  return c.json({
    id: webhook.id,
    tripId: webhook.tripId,
    maskedUrl: maskWebhookUrl(webhook.webhookUrl),
    enabledTypes: webhook.enabledTypes,
    locale: webhook.locale,
    isActive: webhook.isActive,
    lastSuccessAt: webhook.lastSuccessAt,
    failureCount: webhook.failureCount,
    createdBy: webhook.createdBy,
  });
});

// POST /:tripId/discord-webhook — editor+, create webhook
discordWebhookRoutes.post("/:tripId/discord-webhook", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = createDiscordWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.discordWebhooks.findFirst({
    where: eq(discordWebhooks.tripId, tripId),
  });
  if (existing) {
    return c.json({ error: ERROR_MSG.WEBHOOK_ALREADY_EXISTS }, 409);
  }

  const isReachable = await validateWebhookUrl(parsed.data.webhookUrl);
  if (!isReachable) {
    return c.json({ error: ERROR_MSG.WEBHOOK_UNREACHABLE }, 400);
  }

  // The findFirst pre-check above can race a concurrent create; the tripId
  // unique constraint is the source of truth, so map its violation to 409.
  let inserted: typeof discordWebhooks.$inferSelect;
  try {
    [inserted] = await db
      .insert(discordWebhooks)
      .values({
        tripId,
        webhookUrl: parsed.data.webhookUrl,
        enabledTypes: parsed.data.enabledTypes,
        locale: parsed.data.locale,
        createdBy: user.id,
      })
      .returning();
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
      return c.json({ error: ERROR_MSG.WEBHOOK_ALREADY_EXISTS }, 409);
    }
    throw err;
  }

  return c.json(
    {
      id: inserted.id,
      tripId: inserted.tripId,
      maskedUrl: maskWebhookUrl(inserted.webhookUrl),
      enabledTypes: inserted.enabledTypes,
      locale: inserted.locale,
      isActive: inserted.isActive,
      createdBy: inserted.createdBy,
    },
    201,
  );
});

// PUT /:tripId/discord-webhook — editor+, update webhook
discordWebhookRoutes.put("/:tripId/discord-webhook", requireTripAccess("editor"), async (c) => {
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = updateDiscordWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const existing = await db.query.discordWebhooks.findFirst({
    where: eq(discordWebhooks.tripId, tripId),
  });
  if (!existing) {
    return c.json({ error: ERROR_MSG.WEBHOOK_NOT_FOUND }, 404);
  }

  const newUrl = parsed.data.webhookUrl;
  const urlChanged = newUrl && newUrl !== existing.webhookUrl;

  if (urlChanged) {
    const isReachable = await validateWebhookUrl(newUrl);
    if (!isReachable) {
      return c.json({ error: ERROR_MSG.WEBHOOK_UNREACHABLE }, 400);
    }
  }

  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.webhookUrl !== undefined) setData.webhookUrl = parsed.data.webhookUrl;
  if (parsed.data.enabledTypes !== undefined) setData.enabledTypes = parsed.data.enabledTypes;
  if (parsed.data.locale !== undefined) setData.locale = parsed.data.locale;
  if (parsed.data.isActive !== undefined) {
    setData.isActive = parsed.data.isActive;
    if (!parsed.data.isActive) setData.failureCount = 0;
  }

  // Reset failure tracking when URL changes
  if (urlChanged) {
    setData.isActive = true;
    setData.failureCount = 0;
  }

  const [updated] = await db
    .update(discordWebhooks)
    .set(setData)
    .where(eq(discordWebhooks.tripId, tripId))
    .returning();

  return c.json({
    id: updated.id,
    tripId: updated.tripId,
    maskedUrl: maskWebhookUrl(updated.webhookUrl),
    enabledTypes: updated.enabledTypes,
    locale: updated.locale,
    isActive: updated.isActive,
    createdBy: updated.createdBy,
  });
});

// DELETE /:tripId/discord-webhook — editor+, delete webhook
discordWebhookRoutes.delete("/:tripId/discord-webhook", requireTripAccess("editor"), async (c) => {
  const tripId = getParam(c, "tripId");

  await db.delete(discordWebhooks).where(eq(discordWebhooks.tripId, tripId));

  return c.json({ ok: true });
});

// POST /:tripId/discord-webhook/test — editor+, send test notification
discordWebhookRoutes.post(
  "/:tripId/discord-webhook/test",
  requireTripAccess("editor"),
  async (c) => {
    const tripId = getParam(c, "tripId");

    const webhook = await db.query.discordWebhooks.findFirst({
      where: eq(discordWebhooks.tripId, tripId),
      with: { trip: { columns: { title: true } } },
    });
    if (!webhook) {
      return c.json({ error: ERROR_MSG.WEBHOOK_NOT_FOUND }, 404);
    }

    const embed = buildDiscordEmbed({
      type: "member_added",
      payload: { actorName: "sugara", tripName: webhook.trip.title },
      tripId,
      locale: webhook.locale,
      baseUrl: env.FRONTEND_URL,
    });

    // Send directly without affecting failureCount/isActive state
    try {
      const res = await fetch(webhook.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });
      if (!res.ok) {
        return c.json({ error: ERROR_MSG.WEBHOOK_TEST_FAILED }, 502);
      }
      return c.json({ ok: true });
    } catch {
      return c.json({ error: ERROR_MSG.WEBHOOK_TEST_FAILED }, 502);
    }
  },
);

export { discordWebhookRoutes };
