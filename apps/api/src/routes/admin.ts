import { randomBytes } from "node:crypto";
import { DUMMY_EMAIL_DOMAIN, MAX_TRIP_LIMIT, MAX_TRIPS_PER_USER } from "@sugara/shared";
import { and, count, countDistinct, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  accounts,
  appSettings,
  schedules,
  sessions,
  souvenirItems,
  trips,
  users,
} from "../db/schema";
import { getAppSettings, isValidMapsMode } from "../lib/app-settings";
import { logger } from "../lib/logger";
import { getParam } from "../lib/params";
import { hashPassword } from "../lib/password";
import { requireAuth } from "../middleware/auth";
import { requireAdmin } from "../middleware/require-admin";
import type { AppEnv } from "../types";

type TripStatus = "scheduling" | "draft" | "planned" | "active" | "completed";

const adminRoutes = new Hono<AppEnv>();

// Resolves with the value or rejects with Error("query_timeout") after ms milliseconds.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("query_timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

async function fetchStats(sevenDaysAgo: Date, thirtyDaysAgo: Date) {
  // Run sequentially rather than via Promise.all to avoid Supavisor (Supabase's
  // Transaction Pooler) pipeline stalls. Concurrent queries cause PostgreSQL to enter
  // ClientRead wait — Supavisor finishes the query but doesn't forward results back —
  // leading to indefinite hangs. Sequential execution avoids pipelining entirely.
  const totalUsersResult = await db
    .select({ count: count() })
    .from(users)
    .where(eq(users.isAnonymous, false));
  const guestUsersResult = await db
    .select({ count: count() })
    .from(users)
    .where(eq(users.isAnonymous, true));
  const newUsers7dResult = await db
    .select({ count: count() })
    .from(users)
    .where(and(eq(users.isAnonymous, false), gte(users.createdAt, sevenDaysAgo)));
  const newUsers30dResult = await db
    .select({ count: count() })
    .from(users)
    .where(and(eq(users.isAnonymous, false), gte(users.createdAt, thirtyDaysAgo)));
  const tripStatusResult = await db
    .select({ status: trips.status, count: count() })
    .from(trips)
    .groupBy(trips.status);
  const newTrips7dResult = await db
    .select({ count: count() })
    .from(trips)
    .where(gte(trips.createdAt, sevenDaysAgo));
  const totalSchedulesResult = await db.select({ count: count() }).from(schedules);
  const totalSouvenirsResult = await db.select({ count: count() }).from(souvenirItems);
  // MAU: distinct users who created a session in the last 30 days.
  // COUNT(DISTINCT) in DB is far cheaper than SELECT DISTINCT + JS count.
  // Uses createdAt because updatedAt was added manually and has NULL for all existing rows.
  const mauResult = await db
    .select({ count: countDistinct(sessions.userId) })
    .from(sessions)
    .where(gte(sessions.createdAt, thirtyDaysAgo));
  // DB size in bytes. pg_database_size returns bigint; postgres.js serializes
  // bigint as string, so Number() conversion is safe for sizes below 2^53.
  const dbSizeResult = await db.execute(sql`SELECT pg_database_size(current_database()) AS size`);

  return {
    totalUsersResult,
    guestUsersResult,
    newUsers7dResult,
    newUsers30dResult,
    tripStatusResult,
    newTrips7dResult,
    totalSchedulesResult,
    totalSouvenirsResult,
    mauResult,
    dbSizeResult,
  };
}

adminRoutes.get("/api/admin/settings", requireAuth, requireAdmin, async (c) => {
  const settings = await getAppSettings();
  return c.json({
    signupEnabled: settings.signupEnabled,
    mapsMode: settings.mapsMode,
  });
});

adminRoutes.patch("/api/admin/settings", requireAuth, requireAdmin, async (c) => {
  const body = await c.req.json<{ signupEnabled?: unknown; mapsMode?: unknown }>();

  const updates: Record<string, unknown> = {};

  if (body.signupEnabled !== undefined) {
    if (typeof body.signupEnabled !== "boolean") {
      return c.json({ error: "signupEnabled must be a boolean" }, 400);
    }
    updates.signupEnabled = body.signupEnabled;
  }

  if (body.mapsMode !== undefined) {
    if (!isValidMapsMode(body.mapsMode)) {
      return c.json({ error: "mapsMode must be one of: off, admin_only, public" }, 400);
    }
    updates.mapsMode = body.mapsMode;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  await db.update(appSettings).set(updates).where(eq(appSettings.id, 1));

  const updated = await getAppSettings();
  return c.json({
    signupEnabled: updated.signupEnabled,
    mapsMode: updated.mapsMode,
  });
});

adminRoutes.get("/api/admin/stats", requireAuth, requireAdmin, async (c) => {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  let stats: Awaited<ReturnType<typeof fetchStats>>;
  try {
    stats = await withTimeout(fetchStats(sevenDaysAgo, thirtyDaysAgo), 20_000);
  } catch (err) {
    if (err instanceof Error && err.message === "query_timeout") {
      logger.error("Admin stats query timeout after 20s");
      return c.json({ error: "Query timeout" }, 504);
    }
    throw err;
  }

  const {
    totalUsersResult,
    guestUsersResult,
    newUsers7dResult,
    newUsers30dResult,
    tripStatusResult,
    newTrips7dResult,
    totalSchedulesResult,
    totalSouvenirsResult,
    mauResult,
    dbSizeResult,
  } = stats;

  // Build trips.byStatus map
  const statusMap: Record<TripStatus, number> = {
    scheduling: 0,
    draft: 0,
    planned: 0,
    active: 0,
    completed: 0,
  };
  for (const row of tripStatusResult) {
    statusMap[row.status] = Number(row.count);
  }
  const totalTrips = Object.values(statusMap).reduce((a, b) => a + b, 0);

  return c.json({
    users: {
      total: Number(totalUsersResult[0]?.count ?? 0),
      guest: Number(guestUsersResult[0]?.count ?? 0),
      newLast7Days: Number(newUsers7dResult[0]?.count ?? 0),
      newLast30Days: Number(newUsers30dResult[0]?.count ?? 0),
    },
    trips: {
      total: totalTrips,
      byStatus: statusMap,
      newLast7Days: Number(newTrips7dResult[0]?.count ?? 0),
    },
    content: {
      schedules: Number(totalSchedulesResult[0]?.count ?? 0),
      souvenirs: Number(totalSouvenirsResult[0]?.count ?? 0),
    },
    supabase: {
      mau: Number(mauResult[0]?.count ?? 0),
      dbSizeBytes: (() => {
        const row = dbSizeResult[0];
        if (row !== null && typeof row === "object" && "size" in row) {
          const n = Number((row as { size: unknown }).size);
          return Number.isFinite(n) ? n : 0;
        }
        return 0;
      })(),
    },
  });
});

// Exclude ambiguous characters (I, l, 0, O, 1) for readability
const TEMP_PASSWORD_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 12;

function generateTempPassword(): string {
  // Rejection sampling to avoid modulo bias
  const maxValid = 256 - (256 % TEMP_PASSWORD_CHARS.length);
  return Array.from({ length: TEMP_PASSWORD_LENGTH }, () => {
    let byte: number;
    do {
      byte = randomBytes(1)[0];
    } while (byte >= maxValid);
    return TEMP_PASSWORD_CHARS[byte % TEMP_PASSWORD_CHARS.length];
  }).join("");
}

// GET /api/admin/users — ユーザー一覧（管理者専用）
adminRoutes.get("/api/admin/users", requireAuth, requireAdmin, async (c) => {
  const userList = await db
    .select({
      id: users.id,
      username: users.username,
      displayUsername: users.displayUsername,
      email: users.email,
      emailVerified: users.emailVerified,
      tripLimit: users.tripLimit,
      createdAt: users.createdAt,
      tripCount: count(trips.id),
    })
    .from(users)
    .leftJoin(trips, eq(trips.ownerId, users.id))
    .where(eq(users.isAnonymous, false))
    .groupBy(users.id)
    .orderBy(desc(users.createdAt));

  return c.json({
    users: userList.map((u) => ({
      id: u.id,
      username: u.username ?? u.displayUsername ?? "不明",
      hasRealEmail: !!u.email && !u.email.endsWith(`@${DUMMY_EMAIL_DOMAIN}`),
      emailVerified: u.emailVerified,
      createdAt: u.createdAt,
      tripCount: Number(u.tripCount),
      // Effective cap: the per-user override or the global default when unset.
      tripLimit: u.tripLimit ?? MAX_TRIPS_PER_USER,
    })),
  });
});

// PATCH /api/admin/users/:userId/trip-limit — 旅行作成上限の変更（管理者専用）
adminRoutes.patch("/api/admin/users/:userId/trip-limit", requireAuth, requireAdmin, async (c) => {
  const userId = getParam(c, "userId");
  // Hand-rolled validation: apps/api validates request bodies without a direct
  // zod dependency (schemas live in @sugara/shared). A lone tripLimit field
  // doesn't justify adding zod to apps/api's package.json.
  const body = await c.req.json<{ tripLimit?: unknown }>();

  if (
    typeof body.tripLimit !== "number" ||
    !Number.isInteger(body.tripLimit) ||
    body.tripLimit < 1 ||
    body.tripLimit > MAX_TRIP_LIMIT
  ) {
    return c.json({ error: `tripLimit must be an integer between 1 and ${MAX_TRIP_LIMIT}` }, 400);
  }

  const updated = await db
    .update(users)
    .set({ tripLimit: body.tripLimit, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.isAnonymous, false)))
    .returning({ id: users.id, tripLimit: users.tripLimit });

  if (updated.length === 0) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ tripLimit: updated[0].tripLimit ?? MAX_TRIPS_PER_USER });
});

// POST /api/admin/users/:userId/temp-password — 一時パスワード発行
adminRoutes.post("/api/admin/users/:userId/temp-password", requireAuth, requireAdmin, async (c) => {
  const userId = getParam(c, "userId");

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isAnonymous, false)))
    .limit(1);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const updated = await db
    .update(accounts)
    .set({ password: passwordHash, updatedAt: new Date() })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .returning({ id: accounts.id });

  if (updated.length === 0) {
    return c.json({ error: "No credential account found" }, 404);
  }

  return c.json({ tempPassword });
});

adminRoutes.post("/api/admin/announcement", requireAuth, requireAdmin, async (c) => {
  const apiToken = process.env.VERCEL_API_TOKEN;
  const configId = process.env.EDGE_CONFIG_ID;
  if (!apiToken || !configId) {
    return c.json({ error: "Edge Config not configured" }, 503);
  }

  const body = await c.req.json<{ message: unknown }>();
  if (typeof body.message !== "string") {
    return c.json({ error: "message must be a string" }, 400);
  }

  const res = await fetch(`https://api.vercel.com/v1/edge-config/${configId}/items`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ operation: "upsert", key: "announcement", value: body.message }],
    }),
  });

  if (!res.ok) {
    return c.json({ error: "Failed to update Edge Config" }, 502);
  }

  return c.json({ message: body.message || null });
});

export { adminRoutes };
