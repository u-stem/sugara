// Integration tests for v1 write endpoints against the real test PostgreSQL DB.
//
// Prerequisites: sugara_test DB running at TEST_DATABASE_URL
// (default: postgresql://sugara:sugara@localhost:5432/sugara_test)
// Run with: TEST_DATABASE_URL=postgresql://sugara:sugara@127.0.0.1:55322/sugara_test
//           bun run --filter @sugara/api test:integration
//
// Covered scenarios:
//   - POST /trips creates trip_days, default day_pattern, and owner tripMember in real DB
//   - POST schedules appends to default pattern with sortOrder at the end
//   - POST expenses with memberNo persists splits with correct userId
//   - PATCH /trips/:id returns 409 when changing currency on a trip with expenses

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockVerifyApiKey = vi.fn();

vi.mock("../../db/index", async () => {
  const { getTestDb } = await import("./setup");
  return { db: getTestDb() };
});

vi.mock("../../lib/external-api/api-key", () => ({
  verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
}));

vi.mock("../../lib/external-api/rate-limit", () => ({
  v1RateLimit: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock("../../lib/activity-logger", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../../lib/notifications", () => ({
  notifyTripMembersExcluding: vi.fn(),
  notifyUsers: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { expenses, tripDays, tripMembers } from "../../db/schema";
import { v1App } from "../../routes/v1/index";
import { cleanupTables, createTestUser, getTestDb, teardownTestDb } from "./setup";

// ---------------------------------------------------------------------------

describe("v1 write routes integration", () => {
  let userId: string;
  let apiKey: { id: string; userId: string; scopes: string[]; expiresAt: Date };

  beforeEach(async () => {
    await cleanupTables();
    const user = await createTestUser({ name: "Alice", email: "alice@v1writes.test" });
    userId = user.id;
    apiKey = {
      id: "bbbbbbbb-0000-0000-0000-000000000001",
      userId,
      scopes: ["trips:write", "expenses:write"],
      expiresAt: new Date(Date.now() + 3_600_000),
    };
    mockVerifyApiKey.mockResolvedValue(apiKey);
  });

  afterAll(async () => {
    await cleanupTables();
    await teardownTestDb();
  });

  // -------------------------------------------------------------------------
  // POST /trips — data persisted to real DB
  // -------------------------------------------------------------------------

  it("POST /trips creates trip_days with default day_pattern and owner tripMember in DB", async () => {
    // Arrange — WRITE_KEY resolved in beforeEach

    // Act
    const res = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Tokyo Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-03",
      }),
    });

    // Assert: HTTP response
    expect(res.status).toBe(201);
    const body = await res.json();

    const db = getTestDb();

    // Assert: 3 trip days (July 1 – 3 inclusive)
    const days = await db.query.tripDays.findMany({
      where: eq(tripDays.tripId, body.id),
      with: { patterns: true },
    });
    expect(days).toHaveLength(3);

    // Assert: every day has exactly one default pattern
    for (const day of days) {
      expect(day.patterns).toHaveLength(1);
      expect(day.patterns[0].isDefault).toBe(true);
    }

    // Assert: owner tripMember created with role "owner"
    const members = await db.query.tripMembers.findMany({
      where: eq(tripMembers.tripId, body.id),
    });
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(userId);
    expect(members[0].role).toBe("owner");
  });

  // -------------------------------------------------------------------------
  // POST schedules — sortOrder appended at end of default pattern
  // -------------------------------------------------------------------------

  it("POST /trips/:tripId/days/:dayNumber/schedules appends schedule at sortOrder end of default pattern", async () => {
    // Arrange: create a trip first
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Schedule Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-02",
      }),
    });
    expect(tripRes.status).toBe(201);
    const trip = await tripRes.json();

    // Act: add first schedule
    const sched1Res = await v1App.request(`/trips/${trip.id}/days/1/schedules`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tokyo Tower", category: "sightseeing" }),
    });

    // Assert: first schedule at sortOrder 0
    expect(sched1Res.status).toBe(201);
    const sched1 = await sched1Res.json();
    expect(sched1.sortOrder).toBe(0);

    // Act: add second schedule
    const sched2Res = await v1App.request(`/trips/${trip.id}/days/1/schedules`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Senso-ji", category: "sightseeing" }),
    });

    // Assert: second schedule at sortOrder 1 (appended after first)
    expect(sched2Res.status).toBe(201);
    const sched2 = await sched2Res.json();
    expect(sched2.sortOrder).toBe(1);
  });

  // -------------------------------------------------------------------------
  // POST expenses — memberNo resolved to userId in DB splits
  // -------------------------------------------------------------------------

  it("POST /trips/:tripId/expenses persists expense splits with correct userId resolved from memberNo", async () => {
    // Arrange: create a trip and add a second member
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Expense Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
      }),
    });
    expect(tripRes.status).toBe(201);
    const trip = await tripRes.json();

    const db = getTestDb();
    const bob = await createTestUser({ name: "Bob", email: "bob@v1writes.test" });
    await db.insert(tripMembers).values({
      tripId: trip.id,
      userId: bob.id,
      role: "editor",
    });

    // Determine memberNos (assigned by sorted userId order)
    const sortedIds = [userId, bob.id].sort();
    const aliceMemberNo = sortedIds.indexOf(userId) + 1;
    const bobMemberNo = sortedIds.indexOf(bob.id) + 1;

    // Act: POST expense via v1 API using memberNos
    const expRes = await v1App.request(`/trips/${trip.id}/expenses`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Dinner",
        amount: 1000,
        paidByMemberNo: aliceMemberNo,
        splitType: "equal",
        splits: [{ memberNo: aliceMemberNo }, { memberNo: bobMemberNo }],
      }),
    });

    // Assert: response uses memberNo (not userId)
    expect(expRes.status).toBe(201);
    const expBody = await expRes.json();
    expect(expBody.paidBy.memberNo).toBe(aliceMemberNo);

    // Assert: DB stores correct userId for paidBy
    const expRow = await db.query.expenses.findFirst({
      where: eq(expenses.tripId, trip.id),
      with: { splits: true },
    });
    expect(expRow?.paidByUserId).toBe(userId);
    // Both Alice and Bob should have a split row
    const splitUserIds = expRow?.splits.map((s) => s.userId).sort();
    expect(splitUserIds).toEqual([userId, bob.id].sort());
  });

  // -------------------------------------------------------------------------
  // POST USD expense — minor-unit storage
  // -------------------------------------------------------------------------

  it("POST USD expense stores expense.amount and split amounts in minor units", async () => {
    // Arrange: create a USD trip
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "USD Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        currency: "USD",
      }),
    });
    expect(tripRes.status).toBe(201);
    const trip = await tripRes.json();

    const db = getTestDb();
    const bob = await createTestUser({ name: "Bob", email: "bob@usd-expense.test" });
    await db.insert(tripMembers).values({
      tripId: trip.id,
      userId: bob.id,
      role: "editor",
    });

    const sortedIds = [userId, bob.id].sort();
    const aliceMemberNo = sortedIds.indexOf(userId) + 1;
    const bobMemberNo = sortedIds.indexOf(bob.id) + 1;

    // Act: POST expense with decimal USD amount and custom splits
    const expRes = await v1App.request(`/trips/${trip.id}/expenses`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Dinner",
        amount: 12.5,
        currency: "USD",
        paidByMemberNo: aliceMemberNo,
        splitType: "custom",
        splits: [
          { memberNo: aliceMemberNo, amount: 6.25 },
          { memberNo: bobMemberNo, amount: 6.25 },
        ],
      }),
    });

    // Assert: HTTP response
    expect(expRes.status).toBe(201);

    // Assert: DB stores minor units (12.5 USD = 1250 cents; 6.25 USD = 625 cents)
    const expRow = await db.query.expenses.findFirst({
      where: eq(expenses.tripId, trip.id),
      with: { splits: true },
    });
    expect(expRow?.amount).toBe(1250);
    const splitAmounts = expRow?.splits.map((s) => s.amount).sort((a, b) => a - b);
    expect(splitAmounts).toEqual([625, 625]);
  });

  // -------------------------------------------------------------------------
  // PATCH /trips/:id — currency change rejected when expenses exist
  // -------------------------------------------------------------------------

  it("PATCH /trips/:id returns 409 when changing currency on a trip that already has expenses", async () => {
    // Arrange: create trip with JPY currency
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Currency Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
        currency: "JPY",
      }),
    });
    expect(tripRes.status).toBe(201);
    const trip = await tripRes.json();

    // Insert an expense directly so the currency guard fires
    const db = getTestDb();
    await db.insert(expenses).values({
      tripId: trip.id,
      title: "Coffee",
      amount: 500,
      currency: "JPY",
      splitType: "equal",
      paidByUserId: userId,
    });

    // Act: attempt to change currency to USD
    apiKey = { ...apiKey, scopes: ["trips:write"] };
    mockVerifyApiKey.mockResolvedValue(apiKey);
    const patchRes = await v1App.request(`/trips/${trip.id}`, {
      method: "PATCH",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ currency: "USD" }),
    });

    // Assert
    expect(patchRes.status).toBe(409);
    const body = await patchRes.json();
    expect(body.error.code).toBe("conflict");
  });
});
