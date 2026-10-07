import { createHash } from "node:crypto";
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

import { eq } from "drizzle-orm";
import { tripMembers, trips } from "../../db/schema";
import { tripRoutes } from "../../routes/trips";
import { cleanupTables, createTestUser, getTestDb, teardownTestDb } from "./setup";

const SHARE_TOKEN = "T0kenForExposureTests_abcdefghijklmnopqrstu";
const EXPIRES_AT = new Date("2099-01-01T00:00:00.000Z");

type TestUser = { id: string; name: string; email: string };

function createApp() {
  const app = new Hono();
  app.route("/api/trips", tripRoutes);
  return app;
}

function actAs(user: TestUser) {
  mockGetSession.mockImplementation(() => ({ user, session: { id: `session-${user.id}` } }));
}

describe("Share token exposure to trip members", () => {
  const app = createApp();
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let tripId: string;

  beforeEach(async () => {
    await cleanupTables();
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    editor = await createTestUser({ name: "Editor", email: "editor@test.com" });
    viewer = await createTestUser({ name: "Viewer", email: "viewer@test.com" });
    actAs(owner);

    const createRes = await app.request("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Exposure Trip",
        destination: "Kyoto",
        startDate: "2025-04-01",
        endDate: "2025-04-01",
      }),
    });
    tripId = (await createRes.json()).id;

    const db = getTestDb();
    await db.insert(tripMembers).values([
      { tripId, userId: editor.id, role: "editor" },
      { tripId, userId: viewer.id, role: "viewer" },
    ]);
    await db
      .update(trips)
      .set({ shareToken: SHARE_TOKEN, shareTokenExpiresAt: EXPIRES_AT })
      .where(eq(trips.id, tripId));
  });

  afterAll(async () => {
    await cleanupTables();
    await teardownTestDb();
  });

  describe("GET /api/trips/:id", () => {
    it("returns shareToken to the owner", async () => {
      const res = await app.request(`/api/trips/${tripId}`);
      const body = await res.json();

      expect(body.shareToken).toBe(SHARE_TOKEN);
    });

    it("returns shareTokenExpiresAt to the owner", async () => {
      const res = await app.request(`/api/trips/${tripId}`);
      const body = await res.json();

      expect(body.shareTokenExpiresAt).toBe(EXPIRES_AT.toISOString());
    });

    it.each(["editor", "viewer"] as const)("omits shareToken for %s", async (role) => {
      actAs(role === "editor" ? editor : viewer);

      const res = await app.request(`/api/trips/${tripId}`);
      const body = await res.json();

      expect(body.shareToken).toBeUndefined();
    });

    it.each(["editor", "viewer"] as const)("omits shareTokenExpiresAt for %s", async (role) => {
      actAs(role === "editor" ? editor : viewer);

      const res = await app.request(`/api/trips/${tripId}`);
      const body = await res.json();

      expect(body.shareTokenExpiresAt).toBeUndefined();
    });

    it.each(["editor", "viewer"] as const)(
      "does not contain the raw token anywhere in the %s response",
      async (role) => {
        actAs(role === "editor" ? editor : viewer);

        const res = await app.request(`/api/trips/${tripId}`);
        const text = await res.text();

        expect(text).not.toContain(SHARE_TOKEN);
      },
    );

    it.each(["owner", "editor", "viewer"] as const)(
      "returns the SHA-256 channel key of the token to %s",
      async (role) => {
        actAs(role === "owner" ? owner : role === "editor" ? editor : viewer);

        const res = await app.request(`/api/trips/${tripId}`);
        const body = await res.json();

        expect(body.shareChannelKey).toBe(createHash("sha256").update(SHARE_TOKEN).digest("hex"));
      },
    );

    it("returns a null channel key when no share link has been issued", async () => {
      const db = getTestDb();
      await db
        .update(trips)
        .set({ shareToken: null, shareTokenExpiresAt: null })
        .where(eq(trips.id, tripId));

      const res = await app.request(`/api/trips/${tripId}`);
      const body = await res.json();

      expect(body.shareChannelKey).toBeNull();
    });
  });

  describe("GET /api/trips", () => {
    it.each(["editor", "viewer"] as const)("omits shareToken for %s", async (role) => {
      actAs(role === "editor" ? editor : viewer);

      const res = await app.request("/api/trips");
      const body = await res.json();

      expect(body[0].shareToken).toBeUndefined();
    });

    it.each(["editor", "viewer"] as const)("omits shareTokenExpiresAt for %s", async (role) => {
      actAs(role === "editor" ? editor : viewer);

      const res = await app.request("/api/trips");
      const body = await res.json();

      expect(body[0].shareTokenExpiresAt).toBeUndefined();
    });

    it.each(["editor", "viewer"] as const)(
      "does not contain the raw token anywhere in the %s response",
      async (role) => {
        actAs(role === "editor" ? editor : viewer);

        const res = await app.request("/api/trips");
        const text = await res.text();

        expect(text).not.toContain(SHARE_TOKEN);
      },
    );

    it("still returns the list fields the UI relies on", async () => {
      actAs(viewer);

      const res = await app.request("/api/trips");
      const body = await res.json();

      expect(body[0]).toMatchObject({
        id: tripId,
        title: "Exposure Trip",
        role: "viewer",
        totalSchedules: 0,
        memberCount: 3,
      });
    });
  });

  describe("PATCH /api/trips/:id", () => {
    it("does not leak the raw token to an editor", async () => {
      actAs(editor);

      const res = await app.request(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed by editor" }),
      });
      const text = await res.text();

      expect(text).not.toContain(SHARE_TOKEN);
    });
  });
});
