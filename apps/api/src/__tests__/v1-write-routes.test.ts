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
  MAX_SOUVENIRS_PER_USER_PER_TRIP,
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
  mockCreateCandidateCore,
  mockBatchCreateCandidatesCore,
  mockBatchCreateSouvenirsCore,
  mockDbDelete,
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
    souvenirItems: { findFirst: vi.fn() },
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
  mockCreateCandidateCore: vi.fn(),
  mockBatchCreateCandidatesCore: vi.fn(),
  mockBatchCreateSouvenirsCore: vi.fn(),
  mockDbDelete: vi.fn(),
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
    delete: (...args: unknown[]) => mockDbDelete(...args),
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

vi.mock("../lib/candidate-service", () => ({
  createCandidateCore: (...args: unknown[]) => mockCreateCandidateCore(...args),
  batchCreateCandidatesCore: (...args: unknown[]) => mockBatchCreateCandidatesCore(...args),
}));

vi.mock("../lib/souvenir-service", () => ({
  batchCreateSouvenirsCore: (...args: unknown[]) => mockBatchCreateSouvenirsCore(...args),
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

function jsonDelete(path: string) {
  return v1App.request(path, {
    method: "DELETE",
    headers: AUTH_HEADER,
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

  it("returns 201 with schedule DTO and no _meta (only candidate write routes carry _meta)", async () => {
    // This test pins the contract that trips-write schedule routes are not
    // cap-context aware. _meta belongs only on candidate write responses.
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.tripDays.findMany.mockResolvedValue([
      { id: "day-1", dayNumber: 1, patterns: [{ id: "pattern-1" }] },
    ]);
    mockGetScheduleCount.mockResolvedValueOnce(0);
    mockGetNextSortOrder.mockResolvedValueOnce(0);
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([CANDIDATE_ROW]),
      }),
    });

    const res = await jsonPost(`/trips/${TRIP_ID}/days/1/schedules`, {
      name: "Tokyo Tower",
      category: "sightseeing",
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe(CANDIDATE_ROW.id);
    expect(body._meta).toBeUndefined();
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

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

const CANDIDATE_ROW = {
  id: "33333333-0000-0000-0000-000000000001",
  tripId: TRIP_ID,
  dayPatternId: null,
  name: "Tokyo Tower",
  category: "sightseeing" as const,
  startTime: null,
  endTime: null,
  address: null,
  memo: null,
  urls: [],
  departurePlace: null,
  arrivalPlace: null,
  transportMethod: null,
  cost: null,
  color: "blue",
  endDayOffset: null,
  latitude: null,
  longitude: null,
  placeId: null,
  crossDayAnchor: null,
  crossDayAnchorSourceId: null,
  sortOrder: 0,
  createdAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
};

describe("POST /trips/:tripId/candidates", () => {
  it("returns 403 when key has only trips:read", async () => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["trips:read"] });

    const res = await jsonPost(`/trips/${TRIP_ID}/candidates`, {
      name: "Tokyo Tower",
      category: "sightseeing",
    });

    expect(res.status).toBe(403);
  });

  it("includes _meta with post-insert schedule count and max in the 201 response", async () => {
    // Arrange: createCandidateCore inserts 1 row; getScheduleCount returns 1.
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockCreateCandidateCore.mockResolvedValue({ ok: true, schedule: CANDIDATE_ROW });
    mockGetScheduleCount.mockResolvedValueOnce(1);

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/candidates`, {
      name: "Tokyo Tower",
      category: "sightseeing",
    });
    const body = await res.json();

    // Assert
    expect(body._meta).toEqual({ count: 1, max: MAX_SCHEDULES_PER_TRIP });
  });

  it("returns 404 when caller has viewer role (editor-gated)", async () => {
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("viewer");

    const res = await jsonPost(`/trips/${TRIP_ID}/candidates`, {
      name: "Tokyo Tower",
      category: "sightseeing",
    });

    expect(res.status).toBe(404);
  });

  it("returns 201 with no internal id field names in the response", async () => {
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockCreateCandidateCore.mockResolvedValue({ ok: true, schedule: CANDIDATE_ROW });
    // getActorName uses db.query.users.findFirst (not db.select); no mockDbSelect needed.
    // getScheduleCount is mocked separately via mockGetScheduleCount.
    mockGetScheduleCount.mockResolvedValueOnce(3);

    const res = await jsonPost(`/trips/${TRIP_ID}/candidates`, {
      name: "Tokyo Tower",
      category: "sightseeing",
    });
    const body = await res.json();
    const json = JSON.stringify(body);

    expect(res.status).toBe(201);
    expect(body.id).toBe(CANDIDATE_ROW.id);
    expect(body.name).toBe("Tokyo Tower");
    expect(json).not.toContain('"dayPatternId"');
    expect(json).not.toContain('"tripId"');
  });

  it("includes schedule_limit_reached reason and details.max at the per-trip ceiling", async () => {
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockCreateCandidateCore.mockResolvedValue({ ok: false, error: "limit_reached" });

    const res = await jsonPost(`/trips/${TRIP_ID}/candidates`, {
      name: "Tokyo Tower",
      category: "sightseeing",
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("schedule_limit_reached");
    expect(body.error.details).toEqual({ max: MAX_SCHEDULES_PER_TRIP });
  });

  it("returns 400 when the body is missing required fields", async () => {
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");

    const res = await jsonPost(`/trips/${TRIP_ID}/candidates`, { category: "sightseeing" });

    expect(res.status).toBe(400);
  });
});

describe("PATCH /trips/:tripId/candidates/:scheduleId", () => {
  it("returns 404 when the schedule is not a candidate (assigned or missing)", async () => {
    // The handler filters on dayPatternId IS NULL, so an assigned schedule yields
    // no row → 404. This keeps the candidate path distinct from /schedules/:id.
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.schedules.findFirst.mockResolvedValue(undefined);

    const res = await jsonPatch(`/trips/${TRIP_ID}/candidates/${CANDIDATE_ROW.id}`, {
      name: "Updated",
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("returns 400 for a non-UUID scheduleId", async () => {
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");

    const res = await jsonPatch(`/trips/${TRIP_ID}/candidates/not-a-uuid`, { name: "Updated" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  it("returns 200 and the serialized candidate on success", async () => {
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.schedules.findFirst.mockResolvedValue(CANDIDATE_ROW);
    mockGetScheduleCount.mockResolvedValueOnce(3);
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...CANDIDATE_ROW, name: "Updated" }]),
        }),
      }),
    });

    const res = await jsonPatch(`/trips/${TRIP_ID}/candidates/${CANDIDATE_ROW.id}`, {
      name: "Updated",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("Updated");
  });

  it("includes _meta with schedule count and max in the 200 response on update", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.schedules.findFirst.mockResolvedValue(CANDIDATE_ROW);
    mockGetScheduleCount.mockResolvedValueOnce(3);
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...CANDIDATE_ROW, name: "Updated" }]),
        }),
      }),
    });

    // Act
    const res = await jsonPatch(`/trips/${TRIP_ID}/candidates/${CANDIDATE_ROW.id}`, {
      name: "Updated",
    });
    const body = await res.json();

    // Assert
    expect(body._meta).toEqual({ count: 3, max: MAX_SCHEDULES_PER_TRIP });
  });

  it("includes _meta in the 200 response on a no-op update (when no fields change)", async () => {
    // Arrange: send the same name as the existing candidate → hasChanges returns false.
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.schedules.findFirst.mockResolvedValue(CANDIDATE_ROW);
    mockGetScheduleCount.mockResolvedValueOnce(2);

    // Act: same name as existing record → no-op path
    const res = await jsonPatch(`/trips/${TRIP_ID}/candidates/${CANDIDATE_ROW.id}`, {
      name: CANDIDATE_ROW.name,
    });
    const body = await res.json();

    // Assert
    expect(body._meta).toEqual({ count: 2, max: MAX_SCHEDULES_PER_TRIP });
  });
});

// ---------------------------------------------------------------------------
// Souvenirs
// ---------------------------------------------------------------------------

const SOUVENIR_ID = "44444444-0000-0000-0000-000000000001";
const SOUVENIR_MEMBER_ROWS = [{ userId: USER_ID_1 }, { userId: USER_ID_2 }];

function souvenirRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SOUVENIR_ID,
    tripId: TRIP_ID,
    userId: USER_ID_1,
    name: "Matcha KitKat",
    recipient: null,
    urls: [],
    addresses: [],
    memo: null,
    priority: null,
    isPurchased: false,
    isShared: false,
    shareStyle: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

// Mocks the create flow's db calls: count select, insert (capturing values), the
// member lookup, and getActorName's user-name select. Returns the values spy so
// tests can assert what was written.
function arrangeSouvenirCreate(insertedRow: Record<string, unknown>) {
  // 1) per-user count
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ itemCount: 0 }]) }),
  });
  const valuesSpy = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([insertedRow]),
  });
  mockDbInsert.mockReturnValue({ values: valuesSpy });
  mockDbQuery.tripMembers.findMany.mockResolvedValue(SOUVENIR_MEMBER_ROWS);
  // 2) getActorName user-name select
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ name: "Alice" }]) }),
  });
  return valuesSpy;
}

describe("POST /trips/:tripId/souvenirs", () => {
  it("returns 403 when key has only souvenirs:read", async () => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:read"] });

    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs`, { name: "Matcha KitKat" });

    expect(res.status).toBe(403);
  });

  it("includes _meta with post-insert count and max in the 201 response", async () => {
    // Arrange: arrangeSouvenirCreate sets itemCount to 0 → post-insert count is 1.
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("viewer");
    arrangeSouvenirCreate(souvenirRow());

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs`, { name: "Matcha KitKat" });
    const body = await res.json();

    // Assert
    expect(body._meta).toEqual({ count: 1, max: MAX_SOUVENIRS_PER_USER_PER_TRIP });
  });

  it("allows a viewer to create their own souvenir (no editor role required)", async () => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("viewer");
    arrangeSouvenirCreate(souvenirRow());

    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs`, { name: "Matcha KitKat" });
    const body = await res.json();
    const json = JSON.stringify(body);

    expect(res.status).toBe(201);
    // owner is a memberNo ref (USER_ID_1 → memberNo 1), no raw userId leaks
    expect(body.owner).toEqual({ memberNo: 1, displayName: "Alice" });
    expect(json).not.toContain('"userId"');
  });

  it("clears shareStyle when the item is not shared", async () => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
    const valuesSpy = arrangeSouvenirCreate(souvenirRow());

    await jsonPost(`/trips/${TRIP_ID}/souvenirs`, {
      name: "Matcha KitKat",
      isShared: false,
      shareStyle: "errand",
    });

    expect(valuesSpy).toHaveBeenCalledWith(expect.objectContaining({ shareStyle: null }));
  });

  it("includes souvenir_limit_reached reason and details.max at the per-user ceiling", async () => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
    // Reset drops any leftover mockReturnValueOnce from prior tests (vi.clearAllMocks
    // does not drain the once-queue), then a persistent return makes the count select
    // deterministic; the 409 throws right after it.
    mockDbSelect.mockReset();
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ itemCount: MAX_SOUVENIRS_PER_USER_PER_TRIP }]),
      }),
    });

    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs`, { name: "Matcha KitKat" });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("conflict");
    expect(body.error.reason).toBe("souvenir_limit_reached");
    expect(body.error.details).toEqual({ max: MAX_SOUVENIRS_PER_USER_PER_TRIP });
  });
});

describe("PATCH /trips/:tripId/souvenirs/:itemId", () => {
  it("includes _meta with current count and max in the 200 response", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.souvenirItems.findFirst.mockResolvedValue(souvenirRow());
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([souvenirRow()]),
        }),
      }),
    });
    mockDbQuery.tripMembers.findMany.mockResolvedValue(SOUVENIR_MEMBER_ROWS);
    // count SELECT executed after the update (same per-user filter as the cap check)
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ itemCount: 2 }]) }),
    });

    // Act
    const res = await jsonPatch(`/trips/${TRIP_ID}/souvenirs/${SOUVENIR_ID}`, { name: "Updated" });
    const body = await res.json();

    // Assert
    expect(body._meta).toEqual({ count: 2, max: MAX_SOUVENIRS_PER_USER_PER_TRIP });
  });

  it("returns 404 when the souvenir is owned by another member", async () => {
    // The ownership-scoped query (userId === caller) yields no row for others' items.
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.souvenirItems.findFirst.mockResolvedValue(undefined);

    const res = await jsonPatch(`/trips/${TRIP_ID}/souvenirs/${SOUVENIR_ID}`, { name: "Updated" });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("returns 400 for a non-UUID itemId", async () => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");

    const res = await jsonPatch(`/trips/${TRIP_ID}/souvenirs/not-a-uuid`, { name: "Updated" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  it("clears shareStyle when an update turns sharing off", async () => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
    mockDbQuery.souvenirItems.findFirst.mockResolvedValue(
      souvenirRow({ isShared: true, shareStyle: "errand" }),
    );
    const setSpy = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([souvenirRow({ isShared: false, shareStyle: null })]),
      }),
    });
    mockDbUpdate.mockReturnValue({ set: setSpy });
    mockDbQuery.tripMembers.findMany.mockResolvedValue(SOUVENIR_MEMBER_ROWS);
    // count SELECT executed after the update in Promise.all
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ itemCount: 1 }]) }),
    });

    const res = await jsonPatch(`/trips/${TRIP_ID}/souvenirs/${SOUVENIR_ID}`, { isShared: false });

    expect(res.status).toBe(200);
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ shareStyle: null }));
  });
});

// ---------------------------------------------------------------------------
// Candidates — batch create
// ---------------------------------------------------------------------------

function arrangeCandidateBatch(result: {
  created: unknown[];
  skipped: { name: string; reason: "duplicate" | "limit_reached" }[];
}) {
  mockBatchCreateCandidatesCore.mockResolvedValue(result);
  // getScheduleCount is called after the batch for _meta
  mockGetScheduleCount.mockResolvedValue(result.created.length);
}

describe("POST /trips/:tripId/candidates/batch", () => {
  it("returns 403 when key has only trips:read", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["trips:read"] });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/candidates/batch`, {
      items: [{ name: "Tokyo Tower", category: "sightseeing" }],
    });

    // Assert
    expect(res.status).toBe(403);
  });

  it("returns 404 when caller has viewer role (editor-gated)", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("viewer");

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/candidates/batch`, {
      items: [{ name: "Tokyo Tower", category: "sightseeing" }],
    });

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns 400 for an empty items array", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/candidates/batch`, { items: [] });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  it("returns 201 with created, skipped, and _meta when all items are created", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    arrangeCandidateBatch({
      created: [
        CANDIDATE_ROW,
        {
          ...CANDIDATE_ROW,
          id: "33333333-0000-0000-0000-000000000002",
          name: "Akihabara",
          sortOrder: 1,
        },
      ],
      skipped: [],
    });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/candidates/batch`, {
      items: [
        { name: "Tokyo Tower", category: "sightseeing" },
        { name: "Akihabara", category: "sightseeing" },
      ],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(201);
    expect(body.created).toHaveLength(2);
    expect(body.skipped).toHaveLength(0);
    expect(body._meta).toEqual({ count: 2, max: MAX_SCHEDULES_PER_TRIP });
  });

  it("returns 201 with partial success when some items are skipped due to limit", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    arrangeCandidateBatch({
      created: [CANDIDATE_ROW],
      skipped: [{ name: "Akihabara", reason: "limit_reached" }],
    });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/candidates/batch`, {
      items: [
        { name: "Tokyo Tower", category: "sightseeing" },
        { name: "Akihabara", category: "sightseeing" },
      ],
    });
    const body = await res.json();

    // Assert — still 201, no global 409
    expect(res.status).toBe(201);
    expect(body.created).toHaveLength(1);
    expect(body.skipped).toEqual([{ name: "Akihabara", reason: "limit_reached" }]);
  });

  it("returns 201 with duplicate skipped when onConflict is skip", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    arrangeCandidateBatch({
      created: [CANDIDATE_ROW],
      skipped: [{ name: "Tokyo Tower", reason: "duplicate" }],
    });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/candidates/batch`, {
      items: [
        { name: "Tokyo Tower", category: "sightseeing" },
        { name: "Tokyo Tower", category: "sightseeing" },
      ],
      onConflict: "skip",
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(201);
    expect(body.created).toHaveLength(1);
    expect(body.skipped[0]).toEqual({ name: "Tokyo Tower", reason: "duplicate" });
  });

  it("created items have no per-item _meta (only response-level _meta)", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue(WRITE_KEY);
    mockCheckTripAccess.mockResolvedValue("editor");
    arrangeCandidateBatch({ created: [CANDIDATE_ROW], skipped: [] });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/candidates/batch`, {
      items: [{ name: "Tokyo Tower", category: "sightseeing" }],
    });
    const body = await res.json();

    // Assert
    expect(body.created[0]).not.toHaveProperty("_meta");
    expect(body).toHaveProperty("_meta");
  });
});

// ---------------------------------------------------------------------------
// Souvenirs — batch create
// ---------------------------------------------------------------------------

function arrangeSouvenirBatch(result: {
  created: unknown[];
  skipped: { name: string; reason: "duplicate" | "limit_reached" }[];
}) {
  mockBatchCreateSouvenirsCore.mockResolvedValue(result);
  mockDbQuery.tripMembers.findMany.mockResolvedValue(SOUVENIR_MEMBER_ROWS);
  // getActorName uses db.query.users.findFirst, not db.select
  mockDbQuery.users.findFirst.mockResolvedValue({ name: "Alice" });
  // post-batch count SELECT for _meta (the only db.select call in the batch route)
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ itemCount: result.created.length }]),
    }),
  });
}

describe("POST /trips/:tripId/souvenirs/batch", () => {
  it("returns 403 when key has only souvenirs:read", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:read"] });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs/batch`, {
      items: [{ name: "Matcha KitKat" }],
    });

    // Assert
    expect(res.status).toBe(403);
  });

  it("allows a viewer to batch-create their own souvenirs (no editor role required)", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("viewer");
    arrangeSouvenirBatch({ created: [souvenirRow()], skipped: [] });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs/batch`, {
      items: [{ name: "Matcha KitKat" }],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(201);
    expect(body.created).toHaveLength(1);
  });

  it("returns 400 for an empty items array", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs/batch`, { items: [] });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  it("returns 201 with created, skipped, and _meta when all items are created", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
    arrangeSouvenirBatch({
      created: [
        souvenirRow(),
        souvenirRow({ id: "44444444-0000-0000-0000-000000000002", name: "Pocky" }),
      ],
      skipped: [],
    });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs/batch`, {
      items: [{ name: "Matcha KitKat" }, { name: "Pocky" }],
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(201);
    expect(body.created).toHaveLength(2);
    expect(body.skipped).toHaveLength(0);
    expect(body._meta).toEqual({ count: 2, max: MAX_SOUVENIRS_PER_USER_PER_TRIP });
  });

  it("returns 201 with partial success when some items exceed the limit", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
    arrangeSouvenirBatch({
      created: [souvenirRow()],
      skipped: [{ name: "Pocky", reason: "limit_reached" }],
    });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs/batch`, {
      items: [{ name: "Matcha KitKat" }, { name: "Pocky" }],
    });
    const body = await res.json();

    // Assert — still 201, no global 409
    expect(res.status).toBe(201);
    expect(body.created).toHaveLength(1);
    expect(body.skipped).toEqual([{ name: "Pocky", reason: "limit_reached" }]);
  });

  it("returns 201 with duplicate skipped when onConflict is skip", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
    arrangeSouvenirBatch({
      created: [souvenirRow()],
      skipped: [{ name: "Matcha KitKat", reason: "duplicate" }],
    });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs/batch`, {
      items: [{ name: "Matcha KitKat" }, { name: "Matcha KitKat" }],
      onConflict: "skip",
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(201);
    expect(body.created).toHaveLength(1);
    expect(body.skipped[0]).toEqual({ name: "Matcha KitKat", reason: "duplicate" });
  });

  it("created items have no per-item _meta (owner is a memberNo ref)", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
    arrangeSouvenirBatch({ created: [souvenirRow()], skipped: [] });

    // Act
    const res = await jsonPost(`/trips/${TRIP_ID}/souvenirs/batch`, {
      items: [{ name: "Matcha KitKat" }],
    });
    const body = await res.json();

    // Assert: items have owner (memberNo ref) but no _meta on each item
    expect(body.created[0]).not.toHaveProperty("_meta");
    expect(body.created[0]).toHaveProperty("owner");
    expect(body).toHaveProperty("_meta");
  });
});

// ---------------------------------------------------------------------------
// DELETE /trips/:tripId/schedules/:scheduleId
// ---------------------------------------------------------------------------

describe("DELETE /trips/:tripId/schedules/:scheduleId", () => {
  const SCHEDULE_ID = "55555555-0000-0000-0000-000000000001";

  beforeEach(() => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["trips:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
  });

  it("returns 403 when key has only trips:read scope", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["trips:read"] });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/schedules/${SCHEDULE_ID}`);

    // Assert
    expect(res.status).toBe(403);
  });

  it("returns 404 when caller has viewer role (editor-gated)", async () => {
    // Arrange
    mockCheckTripAccess.mockResolvedValue("viewer");

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/schedules/${SCHEDULE_ID}`);

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns 200 with deleted:false when schedule not found or is a candidate", async () => {
    // Arrange: atomic delete returns empty rows (unknown, other trip, or dayPatternId IS NULL)
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    mockGetScheduleCount.mockResolvedValue(2);

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/schedules/${SCHEDULE_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(false);
    expect(body.id).toBe(SCHEDULE_ID);
    expect(body.remaining.count).toBe(2);
  });

  it("returns 200 with deleted:true and correct remaining when assigned schedule deleted", async () => {
    // Arrange: atomic delete returns the removed row; getActorName resolves for notification
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: SCHEDULE_ID, name: "Tokyo Tower" }]),
      }),
    });
    mockGetScheduleCount.mockResolvedValue(1);
    mockDbQuery.users.findFirst.mockResolvedValue({ name: "Alice" });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/schedules/${SCHEDULE_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.remaining).toEqual({ count: 1, max: MAX_SCHEDULES_PER_TRIP });
  });
});

// ---------------------------------------------------------------------------
// DELETE /trips/:tripId/expenses/:expenseId
// ---------------------------------------------------------------------------

describe("DELETE /trips/:tripId/expenses/:expenseId", () => {
  beforeEach(() => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["expenses:write"] });
    mockCheckTripAccess.mockResolvedValue("editor");
  });

  it("returns 403 when key has only expenses:read scope", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["expenses:read"] });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`);

    // Assert
    expect(res.status).toBe(403);
  });

  it("returns 200 with deleted:false when expense not found or belongs to another trip", async () => {
    // Arrange: transaction delete returns empty rows; count query returns current total
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ expenseCount: 3 }]) }),
    });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(false);
    expect(body.id).toBe(EXPENSE_ID);
    expect(body.remaining.count).toBe(3);
    expect(body.remaining.max).toBe(MAX_EXPENSES_PER_TRIP);
  });

  it("returns 200 with deleted:true and resets settlement when expense deleted", async () => {
    // Arrange: first delete (expenses) hits; second delete (settlementPayments) runs
    mockDbDelete
      .mockReturnValueOnce({
        where: vi.fn().mockReturnValue({
          returning: vi
            .fn()
            .mockResolvedValue([
              { id: EXPENSE_ID, title: "Dinner", amount: 3000, currency: "JPY" },
            ]),
        }),
      })
      .mockReturnValueOnce({
        where: vi.fn().mockResolvedValue(undefined),
      });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ expenseCount: 2 }]) }),
    });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.remaining).toEqual({ count: 2, max: MAX_EXPENSES_PER_TRIP });
    // Verify settlement reset: mockDbDelete called twice (expenses + settlementPayments)
    expect(mockDbDelete).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// DELETE /bookmark-lists/:listId
// ---------------------------------------------------------------------------

describe("DELETE /bookmark-lists/:listId", () => {
  beforeEach(() => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["bookmarks:write"] });
  });

  it("returns 403 when key has only bookmarks:read scope", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["bookmarks:read"] });

    // Act
    const res = await jsonDelete(`/bookmark-lists/${LIST_ID}`);

    // Assert
    expect(res.status).toBe(403);
  });

  it("returns 200 with deleted:false when list owned by another user (atomic WHERE guard)", async () => {
    // Arrange: userId mismatch → atomic delete returns empty rows
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ listCount: 1 }]) }),
    });

    // Act
    const res = await jsonDelete(`/bookmark-lists/${LIST_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(false);
    expect(body.id).toBe(LIST_ID);
    expect(body.remaining.max).toBe(MAX_BOOKMARK_LISTS_PER_USER);
  });

  it("returns 200 with deleted:true when caller owns the list", async () => {
    // Arrange: atomic delete hits the caller's list
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: LIST_ID }]),
      }),
    });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ listCount: 0 }]) }),
    });

    // Act
    const res = await jsonDelete(`/bookmark-lists/${LIST_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.remaining).toEqual({ count: 0, max: MAX_BOOKMARK_LISTS_PER_USER });
  });
});

// ---------------------------------------------------------------------------
// DELETE /bookmark-lists/:listId/bookmarks/:bookmarkId
// ---------------------------------------------------------------------------

describe("DELETE /bookmark-lists/:listId/bookmarks/:bookmarkId", () => {
  const BOOKMARK_ID = "66666666-0000-0000-0000-000000000001";

  beforeEach(() => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["bookmarks:write"] });
  });

  it("returns 403 when key has only bookmarks:read scope", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["bookmarks:read"] });

    // Act
    const res = await jsonDelete(`/bookmark-lists/${LIST_ID}/bookmarks/${BOOKMARK_ID}`);

    // Assert
    expect(res.status).toBe(403);
  });

  it("returns 404 when list is not owned by the caller", async () => {
    // Arrange: verifyListOwnership returns null
    mockVerifyListOwnership.mockResolvedValue(null);

    // Act
    const res = await jsonDelete(`/bookmark-lists/${LIST_ID}/bookmarks/${BOOKMARK_ID}`);

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns 200 with deleted:false when bookmark not in this list", async () => {
    // Arrange: list owned, but bookmark atomic delete returns empty rows
    mockVerifyListOwnership.mockResolvedValue({ id: LIST_ID, name: "My List" });
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ bCount: 2 }]) }),
    });

    // Act
    const res = await jsonDelete(`/bookmark-lists/${LIST_ID}/bookmarks/${BOOKMARK_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(false);
    expect(body.id).toBe(BOOKMARK_ID);
    expect(body.remaining.count).toBe(2);
  });

  it("returns 200 with deleted:true when bookmark found and removed", async () => {
    // Arrange: list owned and bookmark atomic delete hits
    mockVerifyListOwnership.mockResolvedValue({ id: LIST_ID, name: "My List" });
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: BOOKMARK_ID }]),
      }),
    });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ bCount: 1 }]) }),
    });

    // Act
    const res = await jsonDelete(`/bookmark-lists/${LIST_ID}/bookmarks/${BOOKMARK_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.remaining).toEqual({ count: 1, max: MAX_BOOKMARKS_PER_LIST });
  });
});

// ---------------------------------------------------------------------------
// DELETE /articles/:articleId
// ---------------------------------------------------------------------------

describe("DELETE /articles/:articleId", () => {
  beforeEach(() => {
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["articles:write"] });
  });

  it("returns 403 when key has only articles:read scope", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["articles:read"] });

    // Act
    const res = await jsonDelete(`/articles/${ARTICLE_ID}`);

    // Assert
    expect(res.status).toBe(403);
  });

  it("returns 200 with deleted:false when article owned by another user (atomic WHERE guard)", async () => {
    // Arrange: ownerId mismatch → atomic delete returns empty rows
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ articleCount: 5 }]) }),
    });

    // Act
    const res = await jsonDelete(`/articles/${ARTICLE_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(false);
    expect(body.id).toBe(ARTICLE_ID);
    expect(body.remaining.count).toBe(5);
    expect(body.remaining.max).toBe(MAX_ARTICLES_PER_USER);
  });

  it("returns 200 with deleted:true and correct remaining when article deleted", async () => {
    // Arrange: atomic delete hits the caller's article; articleTrips/likes cascade in DB
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: ARTICLE_ID }]),
      }),
    });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ articleCount: 4 }]) }),
    });

    // Act
    const res = await jsonDelete(`/articles/${ARTICLE_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.remaining).toEqual({ count: 4, max: MAX_ARTICLES_PER_USER });
  });
});

// ---------------------------------------------------------------------------
// DELETE /trips/:tripId/candidates/:scheduleId
// ---------------------------------------------------------------------------

describe("DELETE /trips/:tripId/candidates/:scheduleId", () => {
  const CANDIDATE_ID = "33333333-0000-0000-0000-000000000001";

  beforeEach(() => {
    mockVerifyApiKey.mockResolvedValue({
      ...WRITE_KEY,
      scopes: ["trips:write"],
    });
    mockCheckTripAccess.mockResolvedValue("editor");
  });

  it("returns 403 when key has only trips:read scope", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["trips:read"] });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/candidates/${CANDIDATE_ID}`);

    // Assert
    expect(res.status).toBe(403);
  });

  it("returns 404 when caller has viewer role (editor-gated)", async () => {
    // Arrange
    mockCheckTripAccess.mockResolvedValue("viewer");

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/candidates/${CANDIDATE_ID}`);

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns 200 with deleted:false when candidate not found or already deleted", async () => {
    // Arrange: atomic delete returns empty rows (id unknown, assigned, or already gone)
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    mockGetScheduleCount.mockResolvedValue(0);

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/candidates/${CANDIDATE_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(false);
    expect(body.id).toBe(CANDIDATE_ID);
  });

  it("returns 200 with deleted:true and correct remaining when candidate deleted", async () => {
    // Arrange: atomic delete returns the removed row; getActorName resolves for notification
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: CANDIDATE_ID, name: "Tokyo Tower" }]),
      }),
    });
    mockGetScheduleCount.mockResolvedValue(0);
    mockDbQuery.users.findFirst.mockResolvedValue({ name: "Alice" });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/candidates/${CANDIDATE_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.remaining).toEqual({ count: 0, max: MAX_SCHEDULES_PER_TRIP });
  });
});

// ---------------------------------------------------------------------------
// DELETE /trips/:tripId/souvenirs/:itemId
// ---------------------------------------------------------------------------

describe("DELETE /trips/:tripId/souvenirs/:itemId", () => {
  const SOUVENIR_ID = "44444444-0000-0000-0000-000000000001";

  beforeEach(() => {
    mockVerifyApiKey.mockResolvedValue({
      ...WRITE_KEY,
      scopes: ["souvenirs:write"],
    });
    mockCheckTripAccess.mockResolvedValue("viewer");
  });

  it("returns 403 when key has only souvenirs:read scope", async () => {
    // Arrange
    mockVerifyApiKey.mockResolvedValue({ ...WRITE_KEY, scopes: ["souvenirs:read"] });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/souvenirs/${SOUVENIR_ID}`);

    // Assert
    expect(res.status).toBe(403);
  });

  it("returns 200 with deleted:false when souvenir not found or owned by another user", async () => {
    // Arrange: atomic delete returns empty rows (not found, another trip, or wrong owner)
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }),
    });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ itemCount: 3 }]),
      }),
    });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/souvenirs/${SOUVENIR_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(false);
    expect(body.remaining.count).toBe(3);
  });

  it("returns 200 with deleted:true and correct remaining when souvenir deleted", async () => {
    // Arrange: atomic delete returns the removed row; count query reflects post-delete state
    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: SOUVENIR_ID }]),
      }),
    });
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ itemCount: 2 }]),
      }),
    });

    // Act
    const res = await jsonDelete(`/trips/${TRIP_ID}/souvenirs/${SOUVENIR_ID}`);
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect(body.remaining).toEqual({ count: 2, max: MAX_SOUVENIRS_PER_USER_PER_TRIP });
  });
});
