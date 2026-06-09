import { createApiKeySchema } from "@sugara/shared";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { apiKeys } from "../db/schema";
import { generateApiKey } from "../lib/external-api/api-key";
import { getParam } from "../lib/params";
import { requireAuth } from "../middleware/auth";
import { requireNonGuest } from "../middleware/require-non-guest";
import type { AppEnv } from "../types";

export const apiKeyRoutes = new Hono<AppEnv>();

// All key-management endpoints require a verified, non-guest session.
// Key issuance is intentionally restricted to non-anonymous accounts (§5).
apiKeyRoutes.use("*", requireAuth, requireNonGuest);

// POST /api/api-keys
// Issues a new API key. The raw key is returned once in this response and is
// never stored or recoverable — only its SHA-256 hash lives in the DB.
apiKeyRoutes.post("/", async (c) => {
  const user = c.get("user");

  const body = await c.req.json();
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const { name, expiresIn, scopes } = parsed.data;
  const { rawKey, keyHash, start } = generateApiKey();
  const expiresAt = new Date(Date.now() + expiresIn * 1000);

  const inserted = await db
    .insert(apiKeys)
    .values({ userId: user.id, name, keyHash, start, scopes, expiresAt })
    .returning({ id: apiKeys.id });

  const id = inserted[0]?.id;
  if (!id) {
    return c.json({ error: "Failed to create API key" }, 500);
  }

  // Do not log the response body — rawKey must not appear in log streams.
  return c.json({ id, name, key: rawKey, start, scopes, expiresAt: expiresAt.toISOString() }, 201);
});

// GET /api/api-keys
// Lists the caller's keys — metadata only. keyHash and the raw key are never returned.
// Ordered newest-first so the most recently created key appears at the top.
apiKeyRoutes.get("/", async (c) => {
  const user = c.get("user");

  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      start: apiKeys.start,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id))
    .orderBy(desc(apiKeys.createdAt));

  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      start: r.start,
      scopes: r.scopes,
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// DELETE /api/api-keys/:id
// Immediately revokes a key. Other users' keys (or non-existent IDs) return 404
// so the response cannot distinguish ownership from existence.
apiKeyRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const keyId = getParam(c, "id");

  // Reject non-UUID ids before reaching the DB. The apiKeys.id column is uuid;
  // a malformed value would cause a Postgres syntax error rather than a clean 404.
  if (!z.string().uuid().safeParse(keyId).success) {
    return c.json({ error: "Invalid ID format" }, 400);
  }

  const deleted = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, user.id)))
    .returning({ id: apiKeys.id });

  if (deleted.length === 0) {
    return c.json({ error: "Not found" }, 404);
  }

  return c.json({ ok: true });
});
