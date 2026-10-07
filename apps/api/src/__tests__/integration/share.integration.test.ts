import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();

vi.mock("../../db/index", async () => {
  const { getTestDb } = await import("./setup");
  return { db: getTestDb() };
});

vi.mock("../../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

import { tripMembers } from "../../db/schema";
import { patternRoutes } from "../../routes/patterns";
import { scheduleRoutes } from "../../routes/schedules";
import { shareRoutes } from "../../routes/share";
import { tripRoutes } from "../../routes/trips";
import { cleanupTables, createTestUser, getTestDb, teardownTestDb } from "./setup";

function createApp() {
  const app = new Hono();
  app.route("/api/trips", tripRoutes);
  app.route("/api/trips", patternRoutes);
  app.route("/api/trips", scheduleRoutes);
  app.route("/", shareRoutes);
  return app;
}

describe("Share Integration", () => {
  const app = createApp();
  let owner: { id: string; name: string; email: string };
  let tripId: string;
  let dayId: string;
  let patternId: string;

  beforeEach(async () => {
    await cleanupTables();
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: owner,
      session: { id: "test-session" },
    }));

    // Create trip with schedule
    const tripRes = await app.request("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Share Test Trip",
        destination: "Tokyo",
        startDate: "2025-04-01",
        endDate: "2025-04-01",
      }),
    });
    const trip = await tripRes.json();
    tripId = trip.id;

    const detailRes = await app.request(`/api/trips/${tripId}`);
    const detail = await detailRes.json();
    dayId = detail.days[0].id;
    patternId = detail.days[0].patterns[0].id;

    await app.request(`/api/trips/${tripId}/days/${dayId}/patterns/${patternId}/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tokyo Tower", category: "sightseeing" }),
    });
  });

  afterAll(async () => {
    await cleanupTables();
    await teardownTestDb();
  });

  it("generates share token", async () => {
    const res = await app.request(`/api/trips/${tripId}/share`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shareToken).toBeDefined();
    expect(body.shareToken.length).toBeGreaterThan(0);
  });

  it("returns same token on subsequent calls", async () => {
    const res1 = await app.request(`/api/trips/${tripId}/share`, {
      method: "POST",
    });
    const body1 = await res1.json();

    const res2 = await app.request(`/api/trips/${tripId}/share`, {
      method: "POST",
    });
    const body2 = await res2.json();

    expect(body1.shareToken).toBe(body2.shareToken);
  });

  it("shared trip is accessible without auth", async () => {
    const shareRes = await app.request(`/api/trips/${tripId}/share`, {
      method: "POST",
    });
    const { shareToken } = await shareRes.json();

    // Access as unauthenticated user
    mockGetSession.mockImplementation(() => null);

    const res = await app.request(`/api/shared/${shareToken}`);
    expect(res.status).toBe(200);
    const trip = await res.json();
    expect(trip.title).toBe("Share Test Trip");
    expect(trip.days).toHaveLength(1);
    expect(trip.days[0].patterns).toHaveLength(1);
    expect(trip.days[0].patterns[0].schedules).toHaveLength(1);
    expect(trip.days[0].patterns[0].schedules[0].name).toBe("Tokyo Tower");
    // Sensitive fields should be excluded
    expect(trip.ownerId).toBeUndefined();
    expect(trip.shareToken).toBeUndefined();
  });

  it("gives shared viewers the same channel key that trip members receive", async () => {
    const shareRes = await app.request(`/api/trips/${tripId}/share`, { method: "POST" });
    const { shareToken } = await shareRes.json();
    const detailRes = await app.request(`/api/trips/${tripId}`);
    const detail = await detailRes.json();

    mockGetSession.mockImplementation(() => null);
    const sharedRes = await app.request(`/api/shared/${shareToken}`);
    const shared = await sharedRes.json();

    expect(shared.shareChannelKey).toBe(detail.shareChannelKey);
  });

  it("derives the channel key from the token without exposing the token", async () => {
    const shareRes = await app.request(`/api/trips/${tripId}/share`, { method: "POST" });
    const { shareToken } = await shareRes.json();

    mockGetSession.mockImplementation(() => null);
    const sharedRes = await app.request(`/api/shared/${shareToken}`);
    const text = await sharedRes.text();

    expect(text).not.toContain(shareToken);
  });

  it("returns 404 for invalid share token", async () => {
    mockGetSession.mockImplementation(() => null);

    const res = await app.request("/api/shared/nonexistent-token");
    expect(res.status).toBe(404);
  });

  it("returns shareTokenExpiresAt when generating a share link", async () => {
    const res = await app.request(`/api/trips/${tripId}/share`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.shareToken).toBeDefined();
    expect(data.shareTokenExpiresAt).toBeDefined();
    expect(new Date(data.shareTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns 404 for expired share link", async () => {
    await app.request(`/api/trips/${tripId}/share`, {
      method: "POST",
    });

    const db = getTestDb();
    const { trips } = await import("../../db/schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(trips)
      .set({ shareTokenExpiresAt: new Date("2020-01-01") })
      .where(eq(trips.id, tripId));

    const trip = await db.query.trips.findFirst({
      where: eq(trips.id, tripId),
    });
    if (!trip) throw new Error("Trip not found");
    const res = await app.request(`/api/shared/${trip.shareToken}`);
    expect(res.status).toBe(404);
  });

  describe("legacy share link without an expiry", () => {
    async function makeLegacyToken(token: string) {
      const db = getTestDb();
      const { trips } = await import("../../db/schema");
      const { eq } = await import("drizzle-orm");
      await db
        .update(trips)
        .set({ shareToken: token, shareTokenExpiresAt: null })
        .where(eq(trips.id, tripId));
    }

    it("returns 404 for the legacy token", async () => {
      await makeLegacyToken("legacy-token-without-expiry");
      mockGetSession.mockImplementation(() => null);

      const res = await app.request("/api/shared/legacy-token-without-expiry");

      expect(res.status).toBe(404);
    });

    it("issues a fresh, expiring token when the owner opens the share dialog", async () => {
      await makeLegacyToken("legacy-token-without-expiry");

      const res = await app.request(`/api/trips/${tripId}/share`, { method: "POST" });
      const data = await res.json();

      expect(new Date(data.shareTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("makes the reissued link viewable", async () => {
      await makeLegacyToken("legacy-token-without-expiry");
      const reissued = await app.request(`/api/trips/${tripId}/share`, { method: "PUT" });
      const { shareToken } = await reissued.json();
      mockGetSession.mockImplementation(() => null);

      const res = await app.request(`/api/shared/${shareToken}`);

      expect(res.status).toBe(200);
    });
  });

  it("regenerates share link with new token and expiry", async () => {
    const first = await app.request(`/api/trips/${tripId}/share`, {
      method: "POST",
    });
    const firstData = await first.json();

    const second = await app.request(`/api/trips/${tripId}/share`, {
      method: "PUT",
    });
    expect(second.status).toBe(200);
    const secondData = await second.json();
    expect(secondData.shareToken).not.toBe(firstData.shareToken);

    // Old token should not work
    mockGetSession.mockImplementation(() => null);
    const oldRes = await app.request(`/api/shared/${firstData.shareToken}`);
    expect(oldRes.status).toBe(404);
  });

  it("editor cannot generate share token", async () => {
    const editor = await createTestUser({ name: "Editor", email: "editor@test.com" });
    const db = getTestDb();
    await db.insert(tripMembers).values({
      tripId,
      userId: editor.id,
      role: "editor",
    });

    mockGetSession.mockImplementation(() => ({
      user: editor,
      session: { id: "editor-session" },
    }));

    const res = await app.request(`/api/trips/${tripId}/share`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});
