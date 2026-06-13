// Unit tests for v1 write endpoints.
//
// Covered scenarios (minimum per spec):
//   - Insufficient scope: read-only key → 403 insufficient_scope
//   - Viewer role on editor-gated routes → 404 (existence concealment)
//   - POST /trips: 201 success, 409 trip-limit exceeded
//   - POST /trips/:tripId/days/:dayNumber/schedules: 409 when trip has no days
//   - POST /trips/:tripId/expenses: 201 + no userId/paidByUserId/ownerId in response,
//       400 unknown memberNo, 400 schema validation failure
//   - PATCH /articles/:id: 404 when article owned by different user
//   - POST /bookmark-lists/:listId/bookmarks: 404 when list owned by different user

import {
  MAX_ARTICLES_PER_USER,
  MAX_BOOKMARK_LISTS_PER_USER,
  MAX_BOOKMARKS_PER_LIST,
  MAX_EXPENSES_PER_TRIP,
  MAX_SCHEDULES_PER_TRIP,
} from "@sugara/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockVerifyApiKey,
  mockCheckTripAccess,
  mockDbQuery,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockUpdateTripCore,
  mockCreateExpenseCore,
  mockUpdateExpenseCore,
  mockVerifyListOwnership,
  mockResolveTripLimit,
  mockCreateInitialTripDays,
  mockGetScheduleCount,
  mockGetNextSortOrder,
} = vi.hoisted(() => ({
  mockVerifyApiKey: vi.fn(),
  mockCheckTripAccess: vi.fn(),
  mockDbQuery: {
    trips: { findFirst: vi.fn() },
    tripMembers: { findMany: vi.fn() },
    expenses: { findFirst: vi.fn(), findMany: vi.fn() },
    expenseSplits: { findMany: vi.fn() },
    bookmarkLists: { findFirst: vi.fn(), findMany: vi.fn() },
    bookmarks: { findFirst: vi.fn(), findMany: vi.fn() },
    articles: { findFirst: vi.fn(), findMany: vi.fn() },
    articleTrips: { findMany: vi.fn() },
    tripDays: { findMany: vi.fn() },
    users: { findFirst: vi.fn() },
    schedules: { findFirst: vi.fn() },
  },
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockUpdateTripCore: vi.fn(),
  mockCreateExpenseCore: vi.fn(),
  mockUpdateExpenseCore: vi.fn(),
  mockVerifyListOwnership: vi.fn(),
  mockResolveTripLimit: vi.fn(),
  mockCreateInitialTripDays: vi.fn(),
  mockGetScheduleCount: vi.fn(),
  mockGetNextSortOrder: vi.fn(),
}));

vi.mock("../lib/external-api/api-key", () => ({
  verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
}));

vi.mock("../lib/permissions", () => ({
  checkTripAccess: (...args: unknown[]) => mockCheckTripAccess(...args),
  canEdit: vi.fn().mockReturnValue(true),
  isOwner: vi.fn().mockReturnValue(true),
}));

vi.mock("../db/index", () => {
  const tx = {
    query: mockDbQuery,
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
  };
  return {
    db: { ...tx, transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  };
});

vi.mock("../lib/external-api/rate-limit", () => ({
  v1RateLimit: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock("../lib/activity-logger", () => ({
  logActivity: vi.fn(),
}));

vi.mock("../lib/notifications", () => ({
  notifyTripMembersExcluding: vi.fn(),
  notifyUsers: vi.fn(),
}));

vi.mock("../lib/trip-service", () => ({
  updateTripCore: (...args: unknown[]) => mockUpdateTripCore(...args),
}));

vi.mock("../lib/expense-service", () => ({
  createExpenseCore: (...args: unknown[]) => mockCreateExpenseCore(...args),
  updateExpenseCore: (...args: unknown[]) => mockUpdateExpenseCore(...args),
}));

vi.mock("../lib/bookmark-ownership", () => ({
  verifyListOwnership: (...args: unknown[]) => mockVerifyListOwnership(...args),
}));

vi.mock("../lib/trip-limit", () => ({
  resolveTripLimit: (...args: unknown[]) => mockResolveTripLimit(...args),
}));

vi.mock("../lib/trip-days", () => ({
  createInitialTripDays: (...args: unknown[]) => mockCreateInitialTripDays(...args),
}));

vi.mock("../lib/schedule-count", () => ({
  getScheduleCount: (...args: unknown[]) => mockGetScheduleCount(...args),
}));

vi.mock("../lib/sort-order", () => ({
  getNextSortOrder: (...args: unknown[]) => mockGetNextSortOrder(...args),
}));

import { v1App } from "../routes/v1/index";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = "cccccccc-0000-0000-0000-000000000001";
// USER_ID_1 < USER_ID_2 lexicographically → memberNo 1 and 2 respectively
const USER_ID_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_ID_2 = "aaaaaaaa-0000-0000-0000-000000000002";
const LIST_ID = "eeeeeeee-0000-0000-0000-000000000001";
const ARTICLE_ID = "11111111-0000-0000-0000-000000000001";
const EXPENSE_ID = "22222222-0000-0000-0000-000000000001";

const WRITE_KEY = {
  id: "bbbbbbbb-0000-0000-0000-000000000001",
  userId: USER_ID_1,
  scopes: ["trips:write", "expenses:write", "bookmarks:write", "articles:write"] as string[],
  expiresAt: new Date(Date.now() + 3_600_000),
};

const AUTH_HEADER = { Authorization: "Bearer sk_test" };

const MEMBER_ROWS = [
  { userId: USER_ID_1, user: { name: "Alice" } },
  { userId: USER_ID_2, user: { name: "Bob" } },
];

const CREATED_TRIP = {
  id: TRIP_ID,
  title: "Test Trip",
  destination: null,
  startDate: "2026-07-01",
  endDate: "2026-07-03",
  currency: "JPY",
  status: "draft" as const,
  ownerId: USER_ID_1,
  coverImageUrl: null,
  coverImagePosition: null,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
};

function jsonPost(path: string, body: unknown) {
  return v1App.request(path, {
    method: "POST",
    headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function jsonPatch(path: string, body: unknown) {
  return v1App.request(path, {
    method: "PATCH",
    headers: { ...AUTH_HEADER, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Scope enforcement
// ---------------------------------------------------------------------------

describe("insufficient scope: read-only key rejected for write endpoints", () => {
  it("POST /trips returns 403 when key has only trips:read", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["trips:read"] });

    // Act
    const res = await jsonPost("/trips", {
      title: "Trip",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
    });

    // Assert
    expect(res.status).toBe(403);
  });

  it("PATCH /trips/:id returns 403 when key has only trips:read", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["trips:read"] });

    // Act
    const res = await jsonPatch(`/trips/${TRIP_ID}`, { title: "New Title" });

    // Assert
    expect(res.status).toBe(403);
  });

  it("POST /trips/:tripId/expenses returns 403 when key has only expenses:read", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["expenses:read"] });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/expenses`, {
      title: "Dinner",
      amount: 1000,
      paidByMemberNo: 1,
      splitType: "equal",
      splits: [{ memberNo: 1 }],
    });

    // Assert
    expect(res.status).toBe(403);
  });

  it("POST /articles returns 403 when key has only articles:read", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["articles:read"] });

    // Act
    const res = await jsonPost("/articles", {
      title: "My Article",
      content: "Hello",
      visibility: "private",
      tags: [],
    });

    // Assert
    expect(res.status).toBe(403);
  });

  it("POST /bookmark-lists/:listId/bookmarks returns 403 when key has only bookmarks:read", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["bookmarks:read"] });

    // Act
    const res = await jsonPost(`/bookmark-lists/${LIST_ID}/bookmarks`, {
      name: "My Place",
      urls: [],
    });

    // Assert
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Viewer role → 404 existence concealment
// ---------------------------------------------------------------------------

describe("viewer role → 404 (existence concealment, not 403)", () => {
  it("PATCH /trips/:id returns 404 when caller has viewer role", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("viewer");

    // Act
    const res = await jsonPatch(`/trips/${TRIP_ID}`, { title: "New Title" });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("POST /trips/:tripId/days/:dayNumber/schedules returns 404 when caller has viewer role", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("viewer");

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/days/1/schedules`, {
      name: "Tokyo Tower",
      category: "sightseeing",
    });

    // Assert
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /trips
// ---------------------------------------------------------------------------

describe("POST /trips", () => {
  it("returns 201 and serializes trip DTO without ownerId", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockResolveTripLimit.mockResolvedValue(10);
    // trip count select inside transaction
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 0 }]),
      }),
    });
    // trips insert
    mockDbInsert
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([CREATED_TRIP]),
        }),
      })
      // tripMembers insert (no .returning())
      .mockReturnValueOnce({
        values: vi.fn().mockResolvedValue([]),
      });
    mockCreateInitialTripDays.mockResolvedValue(undefined);

    // Act
    const res = await jsonPost("/trips", {
      title: "Test Trip",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(201);
    expect(body.id).toBe(TRIP_ID);
    // ownerId must not be in the external DTO
    expect(JSON.stringify(body)).not.toContain("ownerId");
  });

  it("returns 409 when the user has reached the trip creation limit", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockResolveTripLimit.mockResolvedValue(1);
    // trip count equals the limit → transaction returns null
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 1 }]),
      }),
    });

    // Act
    const res = await jsonPost("/trips", {
      title: "Overflow Trip",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
  });

  it("includes trip_limit_reached reason and details.max in the 409 body", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockResolveTripLimit.mockResolvedValue(5);
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ count: 5 }]),
      }),
    });

    // Act
    const res = await jsonPost("/trips", {
      title: "Overflow Trip",
      startDate: "2026-07-01",
      endDate: "2026-07-03",
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("trip_limit_reached");
    expect(body.error.details).toEqual({ max: 5 });
  });
});

// ---------------------------------------------------------------------------
// POST /trips/:tripId/days/:dayNumber/schedules
// ---------------------------------------------------------------------------

describe("POST /trips/:tripId/days/:dayNumber/schedules", () => {
  it("returns 409 when trip has no days (scheduling mode)", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.tripDays.findMany.mockResolvedValue([]);

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/days/1/schedules`, {
      name: "Tokyo Tower",
      category: "sightseeing",
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("trip_has_no_days");
  });

  it("includes schedule_limit_reached reason and details.max when the schedule limit is hit", async () => {
    // Arrange — trip has a day with a default pattern, but the schedule count is
    // already at the per-trip ceiling so the transaction returns null.
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.tripDays.findMany.mockResolvedValue([
      { id: "day-1", dayNumber: 1, patterns: [{ id: "pattern-1" }] },
    ]);
    mockGetScheduleCount.mockResolvedValue(MAX_SCHEDULES_PER_TRIP);

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/days/1/schedules`, {
      name: "Tokyo Tower",
      category: "sightseeing",
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("schedule_limit_reached");
    expect(body.error.details).toEqual({ max: MAX_SCHEDULES_PER_TRIP });
  });
});

// ---------------------------------------------------------------------------
// POST /trips/:tripId/expenses
// ---------------------------------------------------------------------------

describe("POST /trips/:tripId/expenses", () => {
  it("returns 201 and response body contains no userId / paidByUserId / ownerId field names", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    // day count select
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ dayCount: 1 }]),
      }),
    });
    mockDbQuery.tripMembers.findMany.mockResolvedValue(MEMBER_ROWS);
    mockDbQuery.users.findFirst.mockResolvedValue({ name: "Alice" });
    // createExpenseCore returns the inserted row and splits; the route builds the
    // response in memory and serializeExpenseDto converts internal userIds to
    // { memberNo, displayName } refs (no re-SELECT).
    mockCreateExpenseCore.mockResolvedValue({
      ok: true,
      expense: {
        id: EXPENSE_ID,
        title: "Dinner",
        amount: 1000,
        currency: "JPY",
        category: "meals",
        paidByUserId: USER_ID_1,
        createdAt: new Date("2026-06-01T18:00:00Z"),
      },
      splits: [
        { userId: USER_ID_1, amount: 500 },
        { userId: USER_ID_2, amount: 500 },
      ],
    });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/expenses`, {
      title: "Dinner",
      amount: 1000,
      paidByMemberNo: 1,
      splitType: "equal",
      splits: [{ memberNo: 1 }, { memberNo: 2 }],
    });
    const body = await res.json();
    const json = JSON.stringify(body);

    // Assert: status
    expect(res.status).toBe(201);
    // Assert: internal UUIDs are not present in any field name of the response DTO
    expect(json).not.toContain('"userId"');
    expect(json).not.toContain('"paidByUserId"');
    expect(json).not.toContain('"ownerId"');
  });

  it("includes trip_has_no_days reason when the trip is in scheduling mode", async () => {
    // Arrange — day count is zero (scheduling/poll mode)
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ dayCount: 0 }]),
      }),
    });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/expenses`, {
      title: "Dinner",
      amount: 1000,
      paidByMemberNo: 1,
      splitType: "equal",
      splits: [{ memberNo: 1 }],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("trip_has_no_days");
  });

  it("includes expense_limit_reached reason and details.max when the expense limit is hit", async () => {
    // Arrange — service reports the per-trip expense ceiling
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ dayCount: 1 }]),
      }),
    });
    mockDbQuery.tripMembers.findMany.mockResolvedValue(MEMBER_ROWS);
    mockDbQuery.users.findFirst.mockResolvedValue({ name: "Alice" });
    mockCreateExpenseCore.mockResolvedValue({ ok: false, error: "limit_reached" });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/expenses`, {
      title: "Dinner",
      amount: 1000,
      paidByMemberNo: 1,
      splitType: "equal",
      splits: [{ memberNo: 1 }, { memberNo: 2 }],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("expense_limit_reached");
    expect(body.error.details).toEqual({ max: MAX_EXPENSES_PER_TRIP });
  });

  it("returns 400 when paidByMemberNo does not match any trip member", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ dayCount: 1 }]),
      }),
    });
    mockDbQuery.tripMembers.findMany.mockResolvedValue([
      { userId: USER_ID_1, user: { name: "Alice" } },
    ]);

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/expenses`, {
      title: "Dinner",
      amount: 1000,
      paidByMemberNo: 99, // no member has memberNo 99
      splitType: "equal",
      splits: [{ memberNo: 1 }],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  it("returns 400 when request body fails schema validation", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ dayCount: 1 }]),
      }),
    });

    // Act — body is missing required `title` field
    const res = await jsonPost(`/trips/${TRIP_ID}/expenses`, {
      amount: 1000,
      paidByMemberNo: 1,
      splitType: "equal",
      splits: [{ memberNo: 1 }],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });
});

// ---------------------------------------------------------------------------
// PATCH /articles/:id
// ---------------------------------------------------------------------------

describe("PATCH /articles/:id", () => {
  it("returns 404 when article is owned by a different user", async () => {
    // Arrange — key owner is USER_ID_1, article is owned by USER_ID_2
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["articles:write"] });
    mockDbQuery.articles.findFirst.mockResolvedValue({
      id: ARTICLE_ID,
      ownerId: USER_ID_2,
      articleTrips: [],
    });

    // Act
    const res = await jsonPatch(`/articles/${ARTICLE_ID}`, {
      title: "Updated Title",
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
// POST /bookmark-lists/:listId/bookmarks
// ---------------------------------------------------------------------------

describe("POST /bookmark-lists/:listId/bookmarks", () => {
  it("returns 404 when list is owned by a different user", async () => {
    // Arrange — verifyListOwnership returns null when list is not owned by the caller
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["bookmarks:write"] });
    mockVerifyListOwnership.mockResolvedValue(null);

    // Act
    const res = await jsonPost(`/bookmark-lists/${LIST_ID}/bookmarks`, {
      name: "My Place",
      urls: [],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("includes bookmark_limit_reached reason and details.max when the per-list limit is hit", async () => {
    // Arrange — list is owned, but bookmark count is already at the ceiling
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["bookmarks:write"] });
    mockVerifyListOwnership.mockResolvedValue({ id: LIST_ID, userId: USER_ID_1 });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ bCount: MAX_BOOKMARKS_PER_LIST }]),
      }),
    });

    // Act
    const res = await jsonPost(`/bookmark-lists/${LIST_ID}/bookmarks`, {
      name: "My Place",
      urls: [],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("bookmark_limit_reached");
    expect(body.error.details).toEqual({ max: MAX_BOOKMARKS_PER_LIST });
  });
});

// ---------------------------------------------------------------------------
// POST /bookmark-lists — limit
// ---------------------------------------------------------------------------

describe("POST /bookmark-lists", () => {
  it("includes bookmark_list_limit_reached reason and details.max when the account limit is hit", async () => {
    // Arrange — list count is already at the per-account ceiling
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["bookmarks:write"] });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ listCount: MAX_BOOKMARK_LISTS_PER_USER }]),
      }),
    });

    // Act
    const res = await jsonPost("/bookmark-lists", { name: "Trips", visibility: "private" });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("bookmark_list_limit_reached");
    expect(body.error.details).toEqual({ max: MAX_BOOKMARK_LISTS_PER_USER });
  });
});

// ---------------------------------------------------------------------------
// POST /articles — limit
// ---------------------------------------------------------------------------

describe("POST /articles", () => {
  it("includes article_limit_reached reason and details.max when the account limit is hit", async () => {
    // Arrange — article count is already at the per-account ceiling
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["articles:write"] });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ articleCount: MAX_ARTICLES_PER_USER }]),
      }),
    });

    // Act
    const res = await jsonPost("/articles", { title: "My Article" });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("article_limit_reached");
    expect(body.error.details).toEqual({ max: MAX_ARTICLES_PER_USER });
  });
});

// ---------------------------------------------------------------------------
// PATCH /trips/:id — error mapping
// ---------------------------------------------------------------------------

describe("PATCH /trips/:id error mapping", () => {
  it("returns 400 invalid_request when the date change reduces the day count", async () => {
    // Arrange — days_reduced is a permanent validation rule, mapped to 400
    // (matching the internal route), not 409
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockUpdateTripCore.mockResolvedValue({ ok: false, error: "days_reduced" });

    // Act
    const res = await jsonPatch(`/trips/${TRIP_ID}`, {
      startDate: "2026-07-01",
      endDate: "2026-07-02",
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.error).toEqual({
      code: "invalid_request",
      message: "Cannot reduce the number of trip days",
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /trips/:tripId/expenses/:expenseId — amount/splits consistency
// ---------------------------------------------------------------------------

describe("PATCH expense response construction", () => {
  const UPDATED_EXPENSE = {
    id: EXPENSE_ID,
    title: "Dinner",
    amount: 1000,
    currency: "JPY",
    category: "meals",
    paidByUserId: USER_ID_1,
    createdAt: new Date("2026-06-01T18:00:00Z"),
  };

  it("builds the response from the service result without re-selecting splits when splits were updated", async () => {
    // Arrange — updateExpenseCore returns the rewritten splits in memory
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.tripMembers.findMany.mockResolvedValue(MEMBER_ROWS);
    mockUpdateExpenseCore.mockResolvedValue({
      ok: true,
      expense: UPDATED_EXPENSE,
      splits: [
        { userId: USER_ID_1, amount: 500 },
        { userId: USER_ID_2, amount: 500 },
      ],
    });

    // Act
    const res = await jsonPatch(`/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`, {
      splitType: "equal",
      splits: [{ memberNo: 1 }, { memberNo: 2 }],
    });
    const body = await res.json();

    // Assert — splits come from the service result, no fallback SELECT
    expect(res.status).toBe(200);
    expect(mockDbQuery.expenseSplits.findMany).not.toHaveBeenCalled();
    expect(body.splits).toEqual([
      { memberNo: 1, displayName: "Alice", amount: 500 },
      { memberNo: 2, displayName: "Bob", amount: 500 },
    ]);
  });

  it("falls back to selecting splits when the update did not modify them", async () => {
    // Arrange — title-only update: result.splits is undefined
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.tripMembers.findMany.mockResolvedValue(MEMBER_ROWS);
    mockUpdateExpenseCore.mockResolvedValue({ ok: true, expense: UPDATED_EXPENSE });
    mockDbQuery.expenseSplits.findMany.mockResolvedValue([{ userId: USER_ID_1, amount: 1000 }]);

    // Act
    const res = await jsonPatch(`/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`, {
      title: "Dinner",
    });
    const body = await res.json();

    // Assert — splits are fetched once and serialized to memberNo refs
    expect(res.status).toBe(200);
    expect(mockDbQuery.expenseSplits.findMany).toHaveBeenCalledTimes(1);
    expect(body.splits).toEqual([{ memberNo: 1, displayName: "Alice", amount: 1000 }]);
  });

  it("returns 400 when custom split amounts do not sum to the new amount (service validation)", async () => {
    // Arrange — validation moved to service layer (schema refine removed).
    // The service returns split_amount_mismatch which maps to 400 invalid_request.
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.tripMembers.findMany.mockResolvedValue(MEMBER_ROWS);
    mockUpdateExpenseCore.mockResolvedValue({ ok: false, error: "split_amount_mismatch" });

    // Act
    const res = await jsonPatch(`/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`, {
      amount: 1000,
      splitType: "custom",
      splits: [{ memberNo: 1, amount: 500 }],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });
});

// ---------------------------------------------------------------------------
// Schedule write schemas — geolocation fields are not accepted
// ---------------------------------------------------------------------------

describe("v1 schedule schemas strip geolocation fields", () => {
  it("create schema drops latitude/longitude/placeId so write-only values are never stored", async () => {
    // Arrange — no v1 DTO returns these fields; accepting them would store
    // values the caller can never read back
    const { v1CreateScheduleSchema } = await import("../routes/v1/write-schemas");

    // Act
    const parsed = v1CreateScheduleSchema.parse({
      name: "Museum",
      category: "sightseeing",
      latitude: 35.6762,
      longitude: 139.6503,
      placeId: "abc123",
    });

    // Assert
    expect(parsed).not.toHaveProperty("latitude");
  });
});
