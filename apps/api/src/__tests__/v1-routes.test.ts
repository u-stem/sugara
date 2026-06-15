import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyApiKey, mockCheckTripAccess, mockDbQuery, mockDbSelect } = vi.hoisted(() => ({
  mockVerifyApiKey: vi.fn(),
  mockCheckTripAccess: vi.fn(),
  mockDbQuery: {
    trips: { findFirst: vi.fn() },
    tripMembers: { findMany: vi.fn() },
    expenses: { findMany: vi.fn() },
    bookmarkLists: { findFirst: vi.fn(), findMany: vi.fn() },
    bookmarks: { findMany: vi.fn() },
    articles: { findFirst: vi.fn(), findMany: vi.fn() },
    schedules: { findMany: vi.fn() },
    souvenirItems: { findMany: vi.fn() },
  },
  mockDbSelect: vi.fn(),
}));

vi.mock("../lib/external-api/api-key", () => ({
  verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
}));

vi.mock("../lib/permissions", () => ({
  checkTripAccess: (...args: unknown[]) => mockCheckTripAccess(...args),
  canEdit: vi.fn().mockReturnValue(true),
  isOwner: vi.fn().mockReturnValue(true),
}));

vi.mock("../db/index", () => ({
  db: {
    query: mockDbQuery,
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

// Disable rate limiting in all v1 route tests
vi.mock("../lib/external-api/rate-limit", () => ({
  v1RateLimit: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { v1App } from "../routes/v1/index";
import {
  articleDetailResponseSchema,
  articleListResponseSchema,
  bookmarkListsResponseSchema,
  bookmarksResponseSchema,
  expenseListResponseSchema,
  souvenirListResponseSchema,
  tripDetailResponseSchema,
  tripListResponseSchema,
} from "../routes/v1/openapi-schemas";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = "cccccccc-0000-0000-0000-000000000001";
const TRIP_ID_2 = "cccccccc-0000-0000-0000-000000000002";
const LIST_ID = "eeeeeeee-0000-0000-0000-000000000001";
// USER_ID_1 < USER_ID_2 lexicographically → memberNo 1 and 2 respectively
const USER_ID_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_ID_2 = "aaaaaaaa-0000-0000-0000-000000000002";

const VALID_KEY = {
  id: "bbbbbbbb-0000-0000-0000-000000000001",
  userId: USER_ID_1,
  scopes: ["trips:read", "expenses:read", "bookmarks:read", "articles:read"] as string[],
  expiresAt: new Date(Date.now() + 3_600_000),
};

const OTHER_USER_KEY = {
  ...VALID_KEY,
  userId: "ffffffff-0000-0000-0000-000000000001",
  scopes: ["bookmarks:read"] as string[],
};

const AUTH_HEADER = { Authorization: "Bearer sk_test" };

function setupValidKey(key = VALID_KEY) {
  mockVerifyApiKey.mockResolvedValue(key);
}

function mockCountQuery(total: number) {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ total }]),
    }),
  });
}

// Mocks the three sequential db.select() calls made by GET /trips:
//   1. count query  → .from().where()
//   2. trip rows    → .from().innerJoin().where().orderBy().limit().offset()
//   3. member count → .from().where().groupBy()
type TripListRow = {
  id: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  currency: string;
  role: string;
  updatedAt: Date;
};

function mockTripListQueries({
  countTotal,
  tripRows,
  memberCountRows,
}: {
  countTotal: number;
  tripRows: TripListRow[];
  memberCountRows: { tripId: string; memberCount: number }[];
}) {
  const countChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ total: countTotal }]),
    }),
  };
  const tripsChain = {
    from: vi.fn().mockReturnValue({
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue(tripRows),
            }),
          }),
        }),
      }),
    }),
  };
  const mcChain = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        groupBy: vi.fn().mockResolvedValue(memberCountRows),
      }),
    }),
  };
  mockDbSelect
    .mockReturnValueOnce(countChain)
    .mockReturnValueOnce(tripsChain)
    .mockReturnValueOnce(mcChain);
}

// ---------------------------------------------------------------------------
// Trip list — GET /trips
// ---------------------------------------------------------------------------

describe("GET /trips", () => {
  const tripListRow1: TripListRow = {
    id: TRIP_ID,
    title: "Tokyo Trip",
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    currency: "JPY",
    role: "owner",
    updatedAt: new Date("2026-06-10T00:00:00Z"),
  };

  const tripListRow2: TripListRow = {
    id: TRIP_ID_2,
    title: "Osaka Trip",
    startDate: "2026-07-01",
    endDate: null,
    currency: "JPY",
    role: "editor",
    updatedAt: new Date("2026-07-01T00:00:00Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await v1App.request("/trips");

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("returns paginated trip list with correct shape when scope is omitted", async () => {
    setupValidKey();
    mockTripListQueries({
      countTotal: 1,
      tripRows: [tripListRow1],
      memberCountRows: [{ tripId: TRIP_ID, memberCount: 3 }],
    });

    const res = await v1App.request("/trips", { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(TRIP_ID);
    expect(body.data[0].title).toBe("Tokyo Trip");
    expect(body.data[0].role).toBe("owner");
    expect(body.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
  });

  it("returns owner-role trips when scope=owned", async () => {
    setupValidKey();
    mockTripListQueries({
      countTotal: 1,
      tripRows: [tripListRow1],
      memberCountRows: [{ tripId: TRIP_ID, memberCount: 2 }],
    });

    const res = await v1App.request("/trips?scope=owned", { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].role).toBe("owner");
  });

  it("returns non-owner trips when scope=shared", async () => {
    setupValidKey();
    mockTripListQueries({
      countTotal: 1,
      tripRows: [tripListRow2],
      memberCountRows: [{ tripId: TRIP_ID_2, memberCount: 3 }],
    });

    const res = await v1App.request("/trips?scope=shared", { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].role).toBe("editor");
  });

  it("attaches memberCount from the member count subquery", async () => {
    setupValidKey();
    mockTripListQueries({
      countTotal: 1,
      tripRows: [tripListRow1],
      memberCountRows: [{ tripId: TRIP_ID, memberCount: 5 }],
    });

    const res = await v1App.request("/trips", { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].memberCount).toBe(5);
  });

  it("reflects custom limit, offset, and total in the pagination object", async () => {
    setupValidKey();
    mockTripListQueries({
      countTotal: 20,
      tripRows: [tripListRow1, tripListRow2],
      memberCountRows: [
        { tripId: TRIP_ID, memberCount: 2 },
        { tripId: TRIP_ID_2, memberCount: 1 },
      ],
    });

    const res = await v1App.request("/trips?limit=2&offset=10", { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pagination).toEqual({ limit: 2, offset: 10, total: 20 });
  });

  it("returns 400 for an invalid scope value", async () => {
    setupValidKey();

    const res = await v1App.request("/trips?scope=invalid", { headers: AUTH_HEADER });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "invalid_request", message: expect.any(String) } });
  });

  it("200 response body conforms to tripListResponseSchema", async () => {
    setupValidKey();
    mockTripListQueries({
      countTotal: 1,
      tripRows: [tripListRow1],
      memberCountRows: [{ tripId: TRIP_ID, memberCount: 3 }],
    });

    const res = await v1App.request("/trips", { headers: AUTH_HEADER });
    const body = await res.json();

    expect(tripListResponseSchema.safeParse(body).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Trip detail — GET /trips/:id
// ---------------------------------------------------------------------------

describe("GET /trips/:id", () => {
  const memberRows = [
    { userId: USER_ID_1, role: "owner", user: { name: "Alice" } },
    { userId: USER_ID_2, role: "editor", user: { name: "Bob" } },
  ];

  const tripRow = {
    id: TRIP_ID,
    title: "Tokyo Trip",
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    currency: "JPY",
    days: [
      {
        id: "day-1",
        date: "2026-06-01",
        dayNumber: 1,
        patterns: [
          {
            id: "pat-1",
            schedules: [
              {
                id: "sched-1",
                name: "Hotel checkin",
                category: "hotel",
                startTime: "15:00",
                endTime: null,
                address: "Tokyo",
                memo: null,
              },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when key owner is not a trip member", async () => {
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue(null);

    const res = await v1App.request(`/trips/${TRIP_ID}`, { headers: AUTH_HEADER });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("returns 400 for non-UUID trip id", async () => {
    setupValidKey();

    const res = await v1App.request("/trips/not-a-uuid", { headers: AUTH_HEADER });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "invalid_request", message: expect.any(String) } });
  });

  it("returns trip detail with members and days on success", async () => {
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue("owner");
    mockDbQuery.trips.findFirst.mockResolvedValue(tripRow);
    mockDbQuery.tripMembers.findMany.mockResolvedValue(memberRows);

    const res = await v1App.request(`/trips/${TRIP_ID}`, { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(TRIP_ID);
    expect(body.title).toBe("Tokyo Trip");
    expect(body.role).toBe("owner");
    expect(body.members).toHaveLength(2);
    expect(body.days).toHaveLength(1);
    expect(body.days[0].schedules).toHaveLength(1);
    expect(body.days[0].schedules[0].name).toBe("Hotel checkin");
  });

  it("assigns memberNos in stable userId-ascending order", async () => {
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue("owner");
    // Return members in reversed order to verify the sort is applied
    mockDbQuery.trips.findFirst.mockResolvedValue({ ...tripRow, days: [] });
    mockDbQuery.tripMembers.findMany.mockResolvedValue([memberRows[1], memberRows[0]]);

    const res = await v1App.request(`/trips/${TRIP_ID}`, { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    const alice = body.members.find((m: { displayName: string }) => m.displayName === "Alice");
    const bob = body.members.find((m: { displayName: string }) => m.displayName === "Bob");
    // USER_ID_1 < USER_ID_2 → Alice = memberNo 1, Bob = memberNo 2
    expect(alice.memberNo).toBe(1);
    expect(bob.memberNo).toBe(2);
  });

  it("200 response body conforms to tripDetailResponseSchema", async () => {
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue("owner");
    mockDbQuery.trips.findFirst.mockResolvedValue(tripRow);
    mockDbQuery.tripMembers.findMany.mockResolvedValue(memberRows);

    const res = await v1App.request(`/trips/${TRIP_ID}`, { headers: AUTH_HEADER });
    const body = await res.json();

    expect(tripDetailResponseSchema.safeParse(body).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Expense list — GET /trips/:tripId/expenses
// ---------------------------------------------------------------------------

describe("GET /trips/:tripId/expenses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when key owner is not a trip member", async () => {
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue(null);

    const res = await v1App.request(`/trips/${TRIP_ID}/expenses`, { headers: AUTH_HEADER });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("returns expenses with memberNo-based payer and splits", async () => {
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue("owner");

    mockDbQuery.tripMembers.findMany.mockResolvedValue([
      { userId: USER_ID_1, user: { name: "Alice" } },
      { userId: USER_ID_2, user: { name: "Bob" } },
    ]);
    mockCountQuery(1);
    mockDbQuery.expenses.findMany.mockResolvedValue([
      {
        id: "exp-1",
        title: "Dinner",
        amount: 1000,
        currency: "JPY",
        category: "meals",
        paidByUserId: USER_ID_1,
        createdAt: new Date("2026-06-01T18:00:00Z"),
        paidByUser: { name: "Alice" },
        splits: [
          { userId: USER_ID_1, amount: 500, user: { name: "Alice" } },
          { userId: USER_ID_2, amount: 500, user: { name: "Bob" } },
        ],
      },
    ]);

    const res = await v1App.request(`/trips/${TRIP_ID}/expenses`, { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);

    const exp = body.data[0];
    expect(exp.title).toBe("Dinner");
    // USER_ID_1 < USER_ID_2 → Alice is memberNo 1
    expect(exp.paidBy).toEqual({ memberNo: 1, displayName: "Alice" });
    expect(exp.splits).toHaveLength(2);
    expect(exp.splits[0]).toEqual({ memberNo: 1, displayName: "Alice", amount: 500 });
    expect(exp.splits[1]).toEqual({ memberNo: 2, displayName: "Bob", amount: 500 });
  });

  it("payer memberNo matches the memberNo in the members array of the trip", async () => {
    // This test verifies cross-route consistency: the same userId produces the
    // same memberNo regardless of which endpoint is called.
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue("owner");

    const memberRows = [
      { userId: USER_ID_1, role: "owner", user: { name: "Alice" } },
      { userId: USER_ID_2, role: "editor", user: { name: "Bob" } },
    ];

    // First call: trips/:id
    mockDbQuery.trips.findFirst.mockResolvedValue({
      id: TRIP_ID,
      title: "Trip",
      startDate: null,
      endDate: null,
      currency: "JPY",
      days: [],
    });
    mockDbQuery.tripMembers.findMany.mockResolvedValue(memberRows);

    const tripRes = await v1App.request(`/trips/${TRIP_ID}`, { headers: AUTH_HEADER });
    const tripBody = await tripRes.json();
    const aliceFromTrip = tripBody.members.find(
      (m: { displayName: string }) => m.displayName === "Alice",
    );

    // Second call: trips/:tripId/expenses
    mockDbQuery.tripMembers.findMany.mockResolvedValue([
      { userId: USER_ID_1, user: { name: "Alice" } },
      { userId: USER_ID_2, user: { name: "Bob" } },
    ]);
    mockCountQuery(1);
    mockDbQuery.expenses.findMany.mockResolvedValue([
      {
        id: "exp-1",
        title: "Lunch",
        amount: 500,
        currency: "JPY",
        category: null,
        paidByUserId: USER_ID_1,
        createdAt: new Date("2026-06-01T12:00:00Z"),
        paidByUser: { name: "Alice" },
        splits: [],
      },
    ]);

    const expRes = await v1App.request(`/trips/${TRIP_ID}/expenses`, { headers: AUTH_HEADER });
    const expBody = await expRes.json();

    // Alice's memberNo must be identical in both responses
    expect(expBody.data[0].paidBy.memberNo).toBe(aliceFromTrip.memberNo);
  });

  it("200 response body conforms to expenseListResponseSchema", async () => {
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue("owner");
    mockDbQuery.tripMembers.findMany.mockResolvedValue([
      { userId: USER_ID_1, user: { name: "Alice" } },
      { userId: USER_ID_2, user: { name: "Bob" } },
    ]);
    mockCountQuery(1);
    mockDbQuery.expenses.findMany.mockResolvedValue([
      {
        id: "exp-1",
        title: "Dinner",
        amount: 1000,
        currency: "JPY",
        category: "meals",
        paidByUserId: USER_ID_1,
        createdAt: new Date("2026-06-01T18:00:00Z"),
        paidByUser: { name: "Alice" },
        splits: [{ userId: USER_ID_2, amount: 500, user: { name: "Bob" } }],
      },
    ]);

    const res = await v1App.request(`/trips/${TRIP_ID}/expenses`, { headers: AUTH_HEADER });
    const body = await res.json();

    expect(expenseListResponseSchema.safeParse(body).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bookmark lists — GET /bookmark-lists
// ---------------------------------------------------------------------------

describe("GET /bookmark-lists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the authenticated user's own lists", async () => {
    setupValidKey();
    mockCountQuery(2);
    mockDbQuery.bookmarkLists.findMany.mockResolvedValue([
      {
        id: LIST_ID,
        name: "Places",
        visibility: "private",
        sortOrder: 0,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        bookmarks: [{ id: "bm-1" }, { id: "bm-2" }],
      },
      {
        id: "eeeeeeee-0000-0000-0000-000000000002",
        name: "Restaurants",
        visibility: "public",
        sortOrder: 1,
        createdAt: new Date("2026-01-03T00:00:00Z"),
        updatedAt: new Date("2026-01-04T00:00:00Z"),
        bookmarks: [],
      },
    ]);

    const res = await v1App.request("/bookmark-lists", { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].name).toBe("Places");
    expect(body.data[0].bookmarkCount).toBe(2);
    expect(body.data[1].name).toBe("Restaurants");
    expect(body.data[1].bookmarkCount).toBe(0);
    expect(body.pagination.total).toBe(2);
  });

  it("200 response body conforms to bookmarkListsResponseSchema", async () => {
    setupValidKey();
    mockCountQuery(1);
    mockDbQuery.bookmarkLists.findMany.mockResolvedValue([
      {
        id: LIST_ID,
        name: "Places",
        visibility: "private",
        sortOrder: 0,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
        bookmarks: [{ id: "bm-1" }],
      },
    ]);

    const res = await v1App.request("/bookmark-lists", { headers: AUTH_HEADER });
    const body = await res.json();

    expect(bookmarkListsResponseSchema.safeParse(body).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bookmarks in list — GET /bookmark-lists/:listId/bookmarks
// ---------------------------------------------------------------------------

describe("GET /bookmark-lists/:listId/bookmarks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when list is owned by another user", async () => {
    // OTHER_USER_KEY has a different userId than the list owner
    setupValidKey(OTHER_USER_KEY);
    // verifyListOwnership uses db.query.bookmarkLists.findFirst;
    // returning a list owned by a different user triggers the ownership check to fail
    mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
      id: LIST_ID,
      userId: USER_ID_1, // list owned by USER_ID_1, not OTHER_USER_KEY.userId
      name: "Places",
    });

    const res = await v1App.request(`/bookmark-lists/${LIST_ID}/bookmarks`, {
      headers: AUTH_HEADER,
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("returns 404 when list does not exist", async () => {
    setupValidKey();
    mockDbQuery.bookmarkLists.findFirst.mockResolvedValue(null);

    const res = await v1App.request(`/bookmark-lists/${LIST_ID}/bookmarks`, {
      headers: AUTH_HEADER,
    });

    expect(res.status).toBe(404);
  });

  it("returns bookmarks when user owns the list", async () => {
    setupValidKey();
    mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
      id: LIST_ID,
      userId: USER_ID_1, // matches VALID_KEY.userId
      name: "Places",
    });
    mockCountQuery(1);
    mockDbQuery.bookmarks.findMany.mockResolvedValue([
      {
        id: "bm-1",
        name: "Senso-ji",
        memo: "Must visit",
        urls: ["https://example.com"],
        sortOrder: 0,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);

    const res = await v1App.request(`/bookmark-lists/${LIST_ID}/bookmarks`, {
      headers: AUTH_HEADER,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Senso-ji");
    expect(body.data[0].memo).toBe("Must visit");
    expect(body.data[0].urls).toEqual(["https://example.com"]);
    expect(body.pagination.total).toBe(1);
  });

  it("200 response body conforms to bookmarksResponseSchema", async () => {
    setupValidKey();
    mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
      id: LIST_ID,
      userId: USER_ID_1,
      name: "Places",
    });
    mockCountQuery(1);
    mockDbQuery.bookmarks.findMany.mockResolvedValue([
      {
        id: "bm-1",
        name: "Senso-ji",
        memo: "Must visit",
        urls: ["https://example.com"],
        sortOrder: 0,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      },
    ]);

    const res = await v1App.request(`/bookmark-lists/${LIST_ID}/bookmarks`, {
      headers: AUTH_HEADER,
    });
    const body = await res.json();

    expect(bookmarksResponseSchema.safeParse(body).success).toBe(true);
  });

  it("returns 400 for non-UUID list id", async () => {
    setupValidKey();

    const res = await v1App.request("/bookmark-lists/not-a-uuid/bookmarks", {
      headers: AUTH_HEADER,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "invalid_request", message: expect.any(String) } });
  });

  it("accepts q and returns 200 with name-filtered bookmarks", async () => {
    // Arrange
    setupValidKey();
    mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
      id: LIST_ID,
      userId: USER_ID_1,
      name: "Places",
    });
    mockCountQuery(1);
    mockDbQuery.bookmarks.findMany.mockResolvedValue([
      {
        id: "bm-1",
        name: "Senso-ji",
        memo: null,
        urls: [],
        sortOrder: 0,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    // Act
    const res = await v1App.request(`/bookmark-lists/${LIST_ID}/bookmarks?q=Senso`, {
      headers: AUTH_HEADER,
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
  });

  it("treats empty q as no filter and returns all bookmarks", async () => {
    // Arrange
    setupValidKey();
    mockDbQuery.bookmarkLists.findFirst.mockResolvedValue({
      id: LIST_ID,
      userId: USER_ID_1,
      name: "Places",
    });
    mockCountQuery(0);
    mockDbQuery.bookmarks.findMany.mockResolvedValue([]);

    // Act — q= (empty) must not cause 400
    const res = await v1App.request(`/bookmark-lists/${LIST_ID}/bookmarks?q=`, {
      headers: AUTH_HEADER,
    });

    // Assert
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Articles list — GET /articles
// ---------------------------------------------------------------------------

const ARTICLE_ID = "11111111-0000-0000-0000-000000000001";
const TRIP_ID_A = "22222222-0000-0000-0000-000000000001";

const articleSummaryRow = {
  id: ARTICLE_ID,
  title: "Kyoto Trip Report",
  tags: ["kyoto", "japan"],
  visibility: "public" as const,
  sortOrder: 0,
  createdAt: new Date("2026-05-01T00:00:00Z"),
  updatedAt: new Date("2026-05-02T00:00:00Z"),
  articleTrips: [{ tripId: TRIP_ID_A }],
};

describe("GET /articles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the authenticated user's own articles (no content)", async () => {
    setupValidKey();
    mockCountQuery(1);
    mockDbQuery.articles.findMany.mockResolvedValue([articleSummaryRow]);

    const res = await v1App.request("/articles", { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(ARTICLE_ID);
    expect(body.data[0].title).toBe("Kyoto Trip Report");
    expect(body.data[0].tags).toEqual(["kyoto", "japan"]);
    expect(body.data[0].visibility).toBe("public");
    expect(body.data[0].tripIds).toEqual([TRIP_ID_A]);
    expect(body.pagination.total).toBe(1);
  });

  it("does not include content in the list response", async () => {
    setupValidKey();
    mockCountQuery(1);
    mockDbQuery.articles.findMany.mockResolvedValue([articleSummaryRow]);

    const res = await v1App.request("/articles", { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).not.toHaveProperty("content");
  });

  it("200 response body conforms to articleListResponseSchema", async () => {
    setupValidKey();
    mockCountQuery(1);
    mockDbQuery.articles.findMany.mockResolvedValue([articleSummaryRow]);

    const res = await v1App.request("/articles", { headers: AUTH_HEADER });
    const body = await res.json();

    expect(articleListResponseSchema.safeParse(body).success).toBe(true);
  });

  it("accepts q and returns 200 with title-filtered articles", async () => {
    // Arrange
    setupValidKey();
    mockCountQuery(1);
    mockDbQuery.articles.findMany.mockResolvedValue([articleSummaryRow]);

    // Act
    const res = await v1App.request("/articles?q=Kyoto", { headers: AUTH_HEADER });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
  });

  it("treats empty q as no filter and returns all articles", async () => {
    // Arrange
    setupValidKey();
    mockCountQuery(0);
    mockDbQuery.articles.findMany.mockResolvedValue([]);

    // Act — q= (empty) must not cause 400
    const res = await v1App.request("/articles?q=", { headers: AUTH_HEADER });

    // Assert
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Article detail — GET /articles/:id
// ---------------------------------------------------------------------------

describe("GET /articles/:id", () => {
  const articleDetailRow = {
    ...articleSummaryRow,
    ownerId: USER_ID_1,
    content: "## Day 1\n\nArrived in Kyoto...",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when article belongs to another user", async () => {
    setupValidKey(); // VALID_KEY.userId = USER_ID_1
    // Article owned by a different user
    mockDbQuery.articles.findFirst.mockResolvedValue({
      ...articleDetailRow,
      ownerId: "ffffffff-0000-0000-0000-000000000099",
    });

    const res = await v1App.request(`/articles/${ARTICLE_ID}`, { headers: AUTH_HEADER });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("returns 404 when article does not exist", async () => {
    setupValidKey();
    mockDbQuery.articles.findFirst.mockResolvedValue(null);

    const res = await v1App.request(`/articles/${ARTICLE_ID}`, { headers: AUTH_HEADER });

    expect(res.status).toBe(404);
  });

  it("returns full article with content and tripIds when owner requests it", async () => {
    setupValidKey(); // userId = USER_ID_1
    mockDbQuery.articles.findFirst.mockResolvedValue(articleDetailRow); // ownerId = USER_ID_1

    const res = await v1App.request(`/articles/${ARTICLE_ID}`, { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(ARTICLE_ID);
    expect(body.title).toBe("Kyoto Trip Report");
    expect(body.content).toBe("## Day 1\n\nArrived in Kyoto...");
    expect(body.tags).toEqual(["kyoto", "japan"]);
    expect(body.tripIds).toEqual([TRIP_ID_A]);
    expect(body).not.toHaveProperty("ownerId");
  });

  it("200 response body conforms to articleDetailResponseSchema", async () => {
    setupValidKey();
    mockDbQuery.articles.findFirst.mockResolvedValue(articleDetailRow);

    const res = await v1App.request(`/articles/${ARTICLE_ID}`, { headers: AUTH_HEADER });
    const body = await res.json();

    expect(articleDetailResponseSchema.safeParse(body).success).toBe(true);
  });

  it("returns 400 for non-UUID article id", async () => {
    setupValidKey();

    const res = await v1App.request("/articles/not-a-uuid", { headers: AUTH_HEADER });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "invalid_request", message: expect.any(String) } });
  });
});

// ---------------------------------------------------------------------------
// GET /trips/:tripId/candidates
// ---------------------------------------------------------------------------

describe("GET /trips/:tripId/candidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when key owner is not a trip member", async () => {
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue(null);

    const res = await v1App.request(`/trips/${TRIP_ID}/candidates`, { headers: AUTH_HEADER });

    expect(res.status).toBe(404);
  });

  it("returns candidates serialized as schedule DTOs without internal id fields", async () => {
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue("owner");
    mockCountQuery(1);
    mockDbQuery.schedules.findMany.mockResolvedValue([
      {
        id: "cand-1",
        tripId: TRIP_ID,
        dayPatternId: null,
        name: "Tokyo Tower",
        category: "sightseeing",
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
        sortOrder: 0,
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      },
    ]);

    const res = await v1App.request(`/trips/${TRIP_ID}/candidates`, { headers: AUTH_HEADER });
    const body = await res.json();
    const json = JSON.stringify(body);

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Tokyo Tower");
    expect(body.pagination.total).toBe(1);
    expect(json).not.toContain('"dayPatternId"');
    expect(json).not.toContain('"tripId"');
  });

  it("accepts q and returns 200 with data from the filtered DB result", async () => {
    // Arrange
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue("owner");
    mockCountQuery(1);
    mockDbQuery.schedules.findMany.mockResolvedValue([
      {
        id: "cand-1",
        tripId: TRIP_ID,
        dayPatternId: null,
        name: "Tokyo Tower",
        category: "sightseeing",
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
        sortOrder: 0,
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      },
    ]);

    // Act
    const res = await v1App.request(`/trips/${TRIP_ID}/candidates?q=Tower`, {
      headers: AUTH_HEADER,
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Tokyo Tower");
    expect(body.pagination.total).toBe(1);
  });

  it("treats empty q as no filter and returns all candidates", async () => {
    // Arrange
    setupValidKey();
    mockCheckTripAccess.mockResolvedValue("owner");
    mockCountQuery(0);
    mockDbQuery.schedules.findMany.mockResolvedValue([]);

    // Act — q= (empty string after URL decoding) must not cause 400
    const res = await v1App.request(`/trips/${TRIP_ID}/candidates?q=`, { headers: AUTH_HEADER });

    // Assert
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /trips/:tripId/souvenirs
// ---------------------------------------------------------------------------

const SOUVENIR_KEY = {
  ...VALID_KEY,
  scopes: ["souvenirs:read"] as string[],
};

describe("GET /trips/:tripId/souvenirs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when key lacks souvenirs:read", async () => {
    setupValidKey({ ...VALID_KEY, scopes: ["trips:read"] });

    const res = await v1App.request(`/trips/${TRIP_ID}/souvenirs`, { headers: AUTH_HEADER });

    expect(res.status).toBe(403);
  });

  it("returns 404 when key owner is not a trip member", async () => {
    setupValidKey(SOUVENIR_KEY);
    mockCheckTripAccess.mockResolvedValue(null);

    const res = await v1App.request(`/trips/${TRIP_ID}/souvenirs`, { headers: AUTH_HEADER });

    expect(res.status).toBe(404);
  });

  it("returns own and shared items with memberNo-based owner refs, no userId leak", async () => {
    setupValidKey(SOUVENIR_KEY);
    mockCheckTripAccess.mockResolvedValue("owner");
    mockDbQuery.tripMembers.findMany.mockResolvedValue([
      { userId: USER_ID_1 },
      { userId: USER_ID_2 },
    ]);
    mockCountQuery(2);
    mockDbQuery.souvenirItems.findMany.mockResolvedValue([
      {
        id: "souv-1",
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
        user: { name: "Alice" },
      },
      {
        id: "souv-2",
        userId: USER_ID_2,
        name: "Sake",
        recipient: "Dad",
        urls: [],
        addresses: [],
        memo: null,
        priority: "high",
        isPurchased: false,
        isShared: true,
        shareStyle: "recommend",
        createdAt: new Date("2026-06-02T00:00:00Z"),
        updatedAt: new Date("2026-06-02T00:00:00Z"),
        user: { name: "Bob" },
      },
    ]);

    const res = await v1App.request(`/trips/${TRIP_ID}/souvenirs`, { headers: AUTH_HEADER });
    const body = await res.json();
    const json = JSON.stringify(body);

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    // USER_ID_1 < USER_ID_2 → Alice is memberNo 1, Bob is memberNo 2
    expect(body.data[0].owner).toEqual({ memberNo: 1, displayName: "Alice" });
    expect(body.data[1].owner).toEqual({ memberNo: 2, displayName: "Bob" });
    expect(json).not.toContain('"userId"');
  });

  it("conforms to souvenirListResponseSchema", async () => {
    setupValidKey(SOUVENIR_KEY);
    mockCheckTripAccess.mockResolvedValue("owner");
    mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: USER_ID_1 }]);
    mockCountQuery(0);
    mockDbQuery.souvenirItems.findMany.mockResolvedValue([]);

    const res = await v1App.request(`/trips/${TRIP_ID}/souvenirs`, { headers: AUTH_HEADER });
    const body = await res.json();

    expect(souvenirListResponseSchema.safeParse(body).success).toBe(true);
  });

  it("accepts q and returns 200 with filtered data", async () => {
    // Arrange
    setupValidKey(SOUVENIR_KEY);
    mockCheckTripAccess.mockResolvedValue("owner");
    mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: USER_ID_1 }]);
    mockCountQuery(1);
    mockDbQuery.souvenirItems.findMany.mockResolvedValue([
      {
        id: "souv-1",
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
        user: { name: "Alice" },
      },
    ]);

    // Act
    const res = await v1App.request(`/trips/${TRIP_ID}/souvenirs?q=Matcha`, {
      headers: AUTH_HEADER,
    });
    const body = await res.json();

    // Assert
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
  });

  it("treats empty q as no filter and returns all souvenirs", async () => {
    // Arrange
    setupValidKey(SOUVENIR_KEY);
    mockCheckTripAccess.mockResolvedValue("owner");
    mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: USER_ID_1 }]);
    mockCountQuery(0);
    mockDbQuery.souvenirItems.findMany.mockResolvedValue([]);

    // Act
    const res = await v1App.request(`/trips/${TRIP_ID}/souvenirs?q=`, { headers: AUTH_HEADER });

    // Assert — empty q must not cause 400
    expect(res.status).toBe(200);
  });

  it("accepts q with LIKE metacharacters without error", async () => {
    // Arrange — percent sign must be escaped so it is not treated as a wildcard
    setupValidKey(SOUVENIR_KEY);
    mockCheckTripAccess.mockResolvedValue("owner");
    mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: USER_ID_1 }]);
    mockCountQuery(0);
    mockDbQuery.souvenirItems.findMany.mockResolvedValue([]);

    // Act
    const res = await v1App.request(`/trips/${TRIP_ID}/souvenirs?q=100%25`, {
      headers: AUTH_HEADER,
    });

    // Assert — route must not crash or return 400
    expect(res.status).toBe(200);
  });
});
