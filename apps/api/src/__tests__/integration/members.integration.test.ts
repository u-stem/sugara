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

import { handleError } from "../../lib/error-handler";
import { memberRoutes } from "../../routes/members";
import { tripRoutes } from "../../routes/trips";
import { cleanupTables, createTestUser, teardownTestDb } from "./setup";

function createApp() {
  const app = new Hono();
  app.route("/api/trips", tripRoutes);
  app.route("/api/trips", memberRoutes);
  // Mirror production error handling (app.ts registers the same handler);
  // routes now surface conflicts by throwing AppError instead of returning.
  app.onError(handleError);
  return app;
}

describe("Members Integration", () => {
  const app = createApp();
  let owner: { id: string; name: string; email: string };
  let tripId: string;

  beforeEach(async () => {
    await cleanupTables();
    owner = await createTestUser({ name: "Owner", email: "owner@test.com" });
    mockGetSession.mockImplementation(() => ({
      user: owner,
      session: { id: "test-session" },
    }));

    const res = await app.request("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Member Test Trip",
        destination: "Tokyo",
        startDate: "2025-04-01",
        endDate: "2025-04-01",
      }),
    });
    const trip = await res.json();
    tripId = trip.id;
  });

  afterAll(async () => {
    await cleanupTables();
    await teardownTestDb();
  });

  it("lists members including owner", async () => {
    const res = await app.request(`/api/trips/${tripId}/members`);
    expect(res.status).toBe(200);
    const members = await res.json();
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    expect(members[0].name).toBe("Owner");
  });

  it("adds a member by userId", async () => {
    const editor = await createTestUser({ name: "Editor", email: "editor@test.com" });

    const res = await app.request(`/api/trips/${tripId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editor.id, role: "editor" }),
    });
    expect(res.status).toBe(201);

    const listRes = await app.request(`/api/trips/${tripId}/members`);
    const members = await listRes.json();
    expect(members).toHaveLength(2);

    const editorMember = members.find((m: { userId: string }) => m.userId === editor.id);
    expect(editorMember.role).toBe("editor");
  });

  it("prevents adding duplicate member", async () => {
    const editor = await createTestUser({ name: "Editor", email: "editor@test.com" });

    await app.request(`/api/trips/${tripId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editor.id, role: "editor" }),
    });

    const res = await app.request(`/api/trips/${tripId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editor.id, role: "viewer" }),
    });
    expect(res.status).toBe(409);
  });

  it("updates member role", async () => {
    const editor = await createTestUser({ name: "Editor", email: "editor@test.com" });

    await app.request(`/api/trips/${tripId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editor.id, role: "editor" }),
    });

    const res = await app.request(`/api/trips/${tripId}/members/${editor.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(200);

    const listRes = await app.request(`/api/trips/${tripId}/members`);
    const members = await listRes.json();
    const updated = members.find((m: { userId: string }) => m.userId === editor.id);
    expect(updated.role).toBe("viewer");
  });

  it("removes a member", async () => {
    const editor = await createTestUser({ name: "Editor", email: "editor@test.com" });

    await app.request(`/api/trips/${tripId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editor.id, role: "editor" }),
    });

    const res = await app.request(`/api/trips/${tripId}/members/${editor.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const listRes = await app.request(`/api/trips/${tripId}/members`);
    const members = await listRes.json();
    expect(members).toHaveLength(1);
  });

  it("prevents owner from removing self", async () => {
    const res = await app.request(`/api/trips/${tripId}/members/${owner.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
  });

  it("editor cannot add members", async () => {
    const editor = await createTestUser({ name: "Editor", email: "editor@test.com" });

    await app.request(`/api/trips/${tripId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editor.id, role: "editor" }),
    });

    // Switch to editor
    mockGetSession.mockImplementation(() => ({
      user: editor,
      session: { id: "editor-session" },
    }));

    const newUser = await createTestUser({ name: "New", email: "new@test.com" });
    const res = await app.request(`/api/trips/${tripId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: newUser.id, role: "viewer" }),
    });
    expect(res.status).toBe(404);
  });

  it("added member can view the trip in their list", async () => {
    const editor = await createTestUser({ name: "Editor", email: "editor@test.com" });

    await app.request(`/api/trips/${tripId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: editor.id, role: "editor" }),
    });

    // Switch to editor
    mockGetSession.mockImplementation(() => ({
      user: editor,
      session: { id: "editor-session" },
    }));

    const res = await app.request("/api/trips");
    const trips = await res.json();
    expect(trips).toHaveLength(1);
    expect(trips[0].title).toBe("Member Test Trip");
  });
});
