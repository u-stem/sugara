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

import { MAX_SCHEDULES_PER_TRIP, MAX_SOUVENIRS_PER_USER_PER_TRIP } from "@sugara/shared";
import { eq } from "drizzle-orm";
import { articles, expenses, tripDays, tripMembers } from "../../db/schema";
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

  // -------------------------------------------------------------------------
  // POST /articles — sortOrder must not collide after a deletion gap (#137)
  // -------------------------------------------------------------------------

  it("POST /articles assigns a non-colliding sortOrder after an earlier article is deleted", async () => {
    // Arrange: 3 articles (sortOrder 0, 1, 2), then delete the first
    apiKey = { ...apiKey, scopes: ["articles:write"] };
    mockVerifyApiKey.mockResolvedValue(apiKey);

    const createdIds: string[] = [];
    for (const title of ["First", "Second", "Third"]) {
      const res = await v1App.request("/articles", {
        method: "POST",
        headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      expect(res.status).toBe(201);
      createdIds.push((await res.json()).id);
    }

    const db = getTestDb();
    await db.delete(articles).where(eq(articles.id, createdIds[0]));

    // Act: create a new article into the gap
    const res = await v1App.request("/articles", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Fourth" }),
    });
    expect(res.status).toBe(201);

    // Assert: all remaining sortOrders are unique
    const rows = await db.query.articles.findMany({
      where: eq(articles.ownerId, userId),
    });
    const sortOrders = rows.map((r) => r.sortOrder);
    expect(new Set(sortOrders).size).toBe(sortOrders.length);
  });

  // -------------------------------------------------------------------------
  // POST /trips/:tripId/souvenirs — _meta reflects per-user-per-trip count
  // -------------------------------------------------------------------------

  it("POST /trips/:tripId/souvenirs returns _meta with count=1 and correct max after first insert", async () => {
    // Arrange: create trip (owner becomes member automatically)
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Souvenir Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
      }),
    });
    expect(tripRes.status).toBe(201);
    const trip = await tripRes.json();

    apiKey = { ...apiKey, scopes: ["souvenirs:write"] };
    mockVerifyApiKey.mockResolvedValue(apiKey);

    // Act
    const res = await v1App.request(`/trips/${trip.id}/souvenirs`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Matcha KitKat" }),
    });

    // Assert
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body._meta).toEqual({ count: 1, max: MAX_SOUVENIRS_PER_USER_PER_TRIP });
  });

  // -------------------------------------------------------------------------
  // POST /trips/:tripId/candidates/batch
  // -------------------------------------------------------------------------

  it("POST /trips/:tripId/candidates/batch creates all items with consecutive sortOrders", async () => {
    // Arrange: 1-day trip, caller is editor
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Batch Trip", startDate: "2026-07-01", endDate: "2026-07-01" }),
    });
    expect(tripRes.status).toBe(201);
    const trip = await tripRes.json();

    // Act
    const res = await v1App.request(`/trips/${trip.id}/candidates/batch`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { name: "Tokyo Tower", category: "sightseeing" },
          { name: "Akihabara", category: "sightseeing" },
          { name: "Shibuya", category: "sightseeing" },
        ],
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toHaveLength(3);
    expect(body.skipped).toHaveLength(0);
    expect(body._meta.count).toBe(3);

    // sortOrders must be unique and ascending (consecutive allocation in-memory)
    const sortOrders = body.created
      .map((c: { sortOrder: number }) => c.sortOrder)
      .sort((a: number, b: number) => a - b);
    expect(new Set(sortOrders).size).toBe(3);
    expect(sortOrders[1] - sortOrders[0]).toBe(1);
    expect(sortOrders[2] - sortOrders[1]).toBe(1);
  });

  it("POST /trips/:tripId/candidates/batch with onConflict=skip deduplicates by name (trim+lowercase)", async () => {
    // Arrange: create trip and a pre-existing candidate
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Dedup Trip", startDate: "2026-07-01", endDate: "2026-07-01" }),
    });
    const trip = await tripRes.json();

    // Pre-insert one candidate via single create
    const preRes = await v1App.request(`/trips/${trip.id}/candidates`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tokyo Tower", category: "sightseeing" }),
    });
    expect(preRes.status).toBe(201);

    // Act: batch with existing name + case/space variants + in-batch dupe + new name
    const res = await v1App.request(`/trips/${trip.id}/candidates/batch`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { name: "tokyo tower", category: "sightseeing" }, // same after lowercase
          { name: "  Tokyo Tower  ", category: "sightseeing" }, // same after trim
          { name: "Akihabara", category: "sightseeing" }, // new — should be created
          { name: "Akihabara", category: "sightseeing" }, // in-batch dupe — skipped
        ],
        onConflict: "skip",
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const body = await res.json();
    // Only "Akihabara" (first occurrence) is created; the rest are skipped as duplicates
    expect(body.created).toHaveLength(1);
    expect(body.created[0].name).toBe("Akihabara");
    expect(body.skipped).toHaveLength(3);
    expect(body.skipped.every((s: { reason: string }) => s.reason === "duplicate")).toBe(true);
  });

  it("POST /trips/:tripId/candidates/batch with onConflict=create inserts same-name items", async () => {
    // Arrange
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "No-dedup Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
      }),
    });
    const trip = await tripRes.json();

    // Act: two items with the same name, onConflict defaults to "create"
    const res = await v1App.request(`/trips/${trip.id}/candidates/batch`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { name: "Tokyo Tower", category: "sightseeing" },
          { name: "Tokyo Tower", category: "sightseeing" },
        ],
      }),
    });

    // Assert: both inserted, no skipped
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toHaveLength(2);
    expect(body.skipped).toHaveLength(0);
  });

  it("POST /trips/:tripId/candidates/batch returns partial success when limit is reached mid-batch", async () => {
    // Arrange: create a trip and fill it to MAX-1 using many batch calls, then test overflow
    const db = getTestDb();
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Limit Trip", startDate: "2026-07-01", endDate: "2026-07-01" }),
    });
    const trip = await tripRes.json();

    // Fill to MAX_SCHEDULES_PER_TRIP - 1 with individual creates to avoid test complexity
    // (use db directly for speed)
    const { schedules } = await import("../../db/schema");
    const placeholders = Array.from({ length: MAX_SCHEDULES_PER_TRIP - 1 }, (_, i) => ({
      tripId: trip.id,
      name: `Place ${i}`,
      category: "sightseeing" as const,
      sortOrder: i,
    }));
    await db.insert(schedules).values(placeholders);

    // Act: batch with 3 items; only 1 should fit
    const res = await v1App.request(`/trips/${trip.id}/candidates/batch`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { name: "Last Slot", category: "sightseeing" },
          { name: "Overflow 1", category: "sightseeing" },
          { name: "Overflow 2", category: "sightseeing" },
        ],
      }),
    });

    // Assert: 201 with partial success, _meta.count at the cap
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toHaveLength(1);
    expect(body.created[0].name).toBe("Last Slot");
    expect(body.skipped).toHaveLength(2);
    expect(body.skipped.every((s: { reason: string }) => s.reason === "limit_reached")).toBe(true);
    expect(body._meta.count).toBe(MAX_SCHEDULES_PER_TRIP);
  });

  // -------------------------------------------------------------------------
  // POST /trips/:tripId/souvenirs/batch
  // -------------------------------------------------------------------------

  it("POST /trips/:tripId/souvenirs/batch creates all items and returns correct _meta.count", async () => {
    // Arrange: create trip, switch to souvenirs:write scope
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Souvenir Batch Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
      }),
    });
    expect(tripRes.status).toBe(201);
    const trip = await tripRes.json();

    apiKey = { ...apiKey, scopes: ["souvenirs:write"] };
    mockVerifyApiKey.mockResolvedValue(apiKey);

    // Act
    const res = await v1App.request(`/trips/${trip.id}/souvenirs/batch`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ name: "Matcha KitKat" }, { name: "Pocky" }],
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toHaveLength(2);
    expect(body.skipped).toHaveLength(0);
    expect(body._meta).toEqual({ count: 2, max: MAX_SOUVENIRS_PER_USER_PER_TRIP });
  });

  it("POST /trips/:tripId/souvenirs/batch with onConflict=skip deduplicates caller's own items", async () => {
    // Arrange: create trip and a pre-existing souvenir
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Souvenir Dedup Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
      }),
    });
    const trip = await tripRes.json();

    apiKey = { ...apiKey, scopes: ["souvenirs:write"] };
    mockVerifyApiKey.mockResolvedValue(apiKey);

    // Pre-insert one souvenir
    const preRes = await v1App.request(`/trips/${trip.id}/souvenirs`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Matcha KitKat" }),
    });
    expect(preRes.status).toBe(201);

    // Act: batch with existing name + case variant + in-batch dupe + new name
    const res = await v1App.request(`/trips/${trip.id}/souvenirs/batch`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { name: "MATCHA KITKAT" }, // same after lowercase — skipped
          { name: "Pocky" }, // new — created
          { name: "Pocky" }, // in-batch dupe — skipped
        ],
        onConflict: "skip",
      }),
    });

    // Assert
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toHaveLength(1);
    expect(body.created[0].name).toBe("Pocky");
    expect(body.skipped).toHaveLength(2);
    expect(body.skipped.every((s: { reason: string }) => s.reason === "duplicate")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // POST /trips/:tripId/candidates — _meta.count includes ALL schedules
  // (assigned + candidates), not just candidates
  // -------------------------------------------------------------------------

  it("POST /trips/:tripId/candidates _meta.count includes pre-existing assigned schedules", async () => {
    // Arrange: create a 1-day trip and add one schedule to day 1 (assigned).
    // Then POST a candidate. The _meta.count must be 2 (1 assigned + 1 candidate),
    // confirming getScheduleCount counts ALL schedules, not just candidates.
    const tripRes = await v1App.request("/trips", {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Candidate Trip",
        startDate: "2026-07-01",
        endDate: "2026-07-01",
      }),
    });
    expect(tripRes.status).toBe(201);
    const trip = await tripRes.json();

    // Add one assigned schedule to day 1 via the existing schedule endpoint
    const schedRes = await v1App.request(`/trips/${trip.id}/days/1/schedules`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Tokyo Tower", category: "sightseeing" }),
    });
    expect(schedRes.status).toBe(201);

    // Act: POST candidate (unassigned schedule)
    const res = await v1App.request(`/trips/${trip.id}/candidates`, {
      method: "POST",
      headers: { Authorization: "Bearer sk_test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Akihabara", category: "sightseeing" }),
    });

    // Assert: _meta.count is 2 — both assigned schedule and new candidate are
    // counted because MAX_SCHEDULES_PER_TRIP is a trip-wide cap over all schedules.
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body._meta).toEqual({ count: 2, max: MAX_SCHEDULES_PER_TRIP });
  });
});
