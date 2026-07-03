import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSession,
  mockDbQuery,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
  mockDbSelect,
  mockTxSelect,
  mockCreateNotification,
  mockNotifyUsers,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbQuery: {
    expenses: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    tripMembers: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    trips: {
      findFirst: vi.fn(),
    },
    settlementPayments: {
      findMany: vi.fn(),
    },
  },
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbDelete: vi.fn(),
  mockDbSelect: vi.fn(),
  // Records selects issued on the transaction handle (still delegates to
  // mockDbSelect) so tests can assert a query runs INSIDE the transaction.
  mockTxSelect: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockNotifyUsers: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("../db/index", () => {
  const tx = {
    query: mockDbQuery,
    execute: async () => undefined,
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    select: (...args: unknown[]) => {
      mockTxSelect(...args);
      return mockDbSelect(...args);
    },
  };
  return {
    db: {
      ...tx,
      select: (...args: unknown[]) => mockDbSelect(...args),
      transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

vi.mock("../lib/activity-logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notifications", () => ({
  createNotification: (...args: unknown[]) => mockCreateNotification(...args),
  notifyUsers: (...args: unknown[]) => mockNotifyUsers(...args),
}));

import { MAX_EXPENSES_PER_TRIP } from "@sugara/shared";
import { logActivity } from "../lib/activity-logger";
import { expenseRoutes } from "../routes/expenses";
import { createTestApp, TEST_USER } from "./test-helpers";

const fakeUser = TEST_USER;
const tripId = "trip-1";
// UUID values for Zod validation
const userId1 = "00000000-0000-0000-0000-000000000001";
const userId2 = "00000000-0000-0000-0000-000000000002";

function setupAuth(role: "owner" | "editor" | "viewer" = "owner") {
  mockGetSession.mockResolvedValue({
    user: fakeUser,
    session: { id: "session-1" },
  });
  mockDbQuery.tripMembers.findFirst.mockResolvedValue({
    tripId,
    userId: fakeUser.id,
    role,
  });
}

function makeApp() {
  return createTestApp(expenseRoutes, "/api/trips");
}

function mockCountQuery(count: number) {
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ count }]),
    }),
  });
}

describe("Expense routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    mockDbQuery.trips.findFirst.mockResolvedValue({ title: "テスト旅行" });
    mockDbQuery.settlementPayments.findMany.mockResolvedValue([]);
    mockCreateNotification.mockResolvedValue(undefined);
    // Default: auto-reset of settlement payments needs .where() chain
    mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  });

  describe("GET /api/trips/:tripId/expenses", () => {
    it("returns empty expenses and settlement", async () => {
      mockDbQuery.expenses.findMany.mockResolvedValue([]);
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: fakeUser.id, user: { id: fakeUser.id, name: fakeUser.name } },
      ]);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.expenses).toEqual([]);
      expect(json.settlement.totalAmount).toBe(0);
      expect(json.settlement.transfers).toEqual([]);
    });

    it("returns expenses with splits and settlement", async () => {
      mockDbQuery.expenses.findMany.mockResolvedValue([
        {
          id: "exp-1",
          title: "Dinner",
          amount: 1000,
          splitType: "equal",
          paidByUserId: userId1,
          paidByUser: { id: userId1, name: "User 1" },
          splits: [
            { userId: userId1, amount: 500, user: { id: userId1, name: "User 1" } },
            { userId: userId2, amount: 500, user: { id: userId2, name: "User 2" } },
          ],
          createdAt: "2026-01-01T00:00:00Z",
        },
      ]);
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1, user: { id: userId1, name: "User 1" } },
        { userId: userId2, user: { id: userId2, name: "User 2" } },
      ]);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.expenses).toHaveLength(1);
      expect(json.expenses[0].title).toBe("Dinner");
      expect(json.settlement.totalAmount).toBe(1000);
      expect(json.settlement.transfers).toHaveLength(1);
    });

    it("allows viewer access", async () => {
      setupAuth("viewer");
      mockDbQuery.expenses.findMany.mockResolvedValue([]);
      mockDbQuery.tripMembers.findMany.mockResolvedValue([]);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`);
      expect(res.status).toBe(200);
    });

    it("returns categoryTotals in response", async () => {
      mockDbQuery.expenses.findMany.mockResolvedValue([
        {
          id: "exp-1",
          title: "Train",
          amount: 500,
          splitType: "equal",
          category: "transportation",
          paidByUserId: userId1,
          paidByUser: { id: userId1, name: "User 1" },
          splits: [
            { userId: userId1, amount: 250, user: { id: userId1, name: "User 1" } },
            { userId: userId2, amount: 250, user: { id: userId2, name: "User 2" } },
          ],
          createdAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "exp-2",
          title: "Bus",
          amount: 300,
          splitType: "equal",
          category: "transportation",
          paidByUserId: userId2,
          paidByUser: { id: userId2, name: "User 2" },
          splits: [
            { userId: userId1, amount: 150, user: { id: userId1, name: "User 1" } },
            { userId: userId2, amount: 150, user: { id: userId2, name: "User 2" } },
          ],
          createdAt: "2026-01-02T00:00:00Z",
        },
        {
          id: "exp-3",
          title: "Misc",
          amount: 200,
          splitType: "equal",
          category: null,
          paidByUserId: userId1,
          paidByUser: { id: userId1, name: "User 1" },
          splits: [
            { userId: userId1, amount: 100, user: { id: userId1, name: "User 1" } },
            { userId: userId2, amount: 100, user: { id: userId2, name: "User 2" } },
          ],
          createdAt: "2026-01-03T00:00:00Z",
        },
      ]);
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1, user: { id: userId1, name: "User 1" } },
        { userId: userId2, user: { id: userId2, name: "User 2" } },
      ]);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.categoryTotals).toBeDefined();
      expect(json.categoryTotals).toHaveLength(2);
      const transportation = json.categoryTotals.find(
        (c: { category: string | null }) => c.category === "transportation",
      );
      expect(transportation.total).toBe(800);
      expect(transportation.count).toBe(2);
      // Uncategorized expenses are grouped under a null category
      const uncategorized = json.categoryTotals.find(
        (c: { category: string | null }) => c.category === null,
      );
      expect(uncategorized.total).toBe(200);
      expect(uncategorized.count).toBe(1);
    });
  });

  describe("POST /api/trips/:tripId/expenses", () => {
    const validBody = {
      title: "Dinner",
      amount: 1000,
      paidByUserId: userId1,
      splitType: "equal" as const,
      splits: [{ userId: userId1 }, { userId: userId2 }],
    };

    it("creates expense with equal split", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockCountQuery(0);
      // First insert returns expense, second insert (splits) also needs mock
      mockDbInsert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValueOnce([{ id: "exp-1", ...validBody, createdAt: new Date() }]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(201);
      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId,
          action: "created",
          entityType: "expense",
          entityName: "Dinner",
        }),
      );
    });

    it("creates expense with custom split", async () => {
      const customBody = {
        title: "Hotel",
        amount: 1000,
        paidByUserId: userId1,
        splitType: "custom",
        splits: [
          { userId: userId1, amount: 300 },
          { userId: userId2, amount: 700 },
        ],
      };
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockCountQuery(0);
      mockDbInsert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValueOnce([{ id: "exp-2", ...customBody, createdAt: new Date() }]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customBody),
      });

      expect(res.status).toBe(201);
    });

    it("creates expense with itemized split and line items", async () => {
      const itemizedBody = {
        title: "居酒屋",
        amount: 5000,
        paidByUserId: userId1,
        splitType: "itemized",
        splits: [
          { userId: userId1, amount: 3000 },
          { userId: userId2, amount: 2000 },
        ],
        lineItems: [
          { name: "料理", amount: 3000, memberIds: [userId1, userId2] },
          { name: "ビール", amount: 2000, memberIds: [userId1] },
        ],
      };
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockCountQuery(0);
      mockDbInsert
        // expense insert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValueOnce([{ id: "exp-3", ...itemizedBody, createdAt: new Date() }]),
          }),
        })
        // splits bulk insert
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        })
        // lineItems bulk insert + returning (both items in one call)
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValueOnce([
              { id: "li-1", sortOrder: 0 },
              { id: "li-2", sortOrder: 1 },
            ]),
          }),
        })
        // lineItemMembers bulk insert (all member rows in one call)
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemizedBody),
      });

      expect(res.status).toBe(201);
      // expense + splits + lineItems + lineItemMembers = 4 bulk inserts (was 6 with per-item N+1)
      expect(mockDbInsert).toHaveBeenCalledTimes(4);
    });

    it("returns 400 when itemized split total does not match amount", async () => {
      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "居酒屋",
          amount: 5000,
          paidByUserId: userId1,
          splitType: "itemized",
          splits: [
            { userId: userId1, amount: 2000 },
            { userId: userId2, amount: 2000 },
          ],
          lineItems: [{ name: "料理", amount: 4000, memberIds: [userId1, userId2] }],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when lineItem memberIds contains non-member", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockCountQuery(0);
      const nonMemberId = "00000000-0000-0000-0000-000000000099";

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "居酒屋",
          amount: 5000,
          paidByUserId: userId1,
          splitType: "itemized",
          splits: [
            { userId: userId1, amount: 3000 },
            { userId: userId2, amount: 2000 },
          ],
          lineItems: [{ name: "料理", amount: 5000, memberIds: [userId1, nonMemberId] }],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when itemized split has no lineItems", async () => {
      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "居酒屋",
          amount: 5000,
          paidByUserId: userId1,
          splitType: "itemized",
          splits: [
            { userId: userId1, amount: 3000 },
            { userId: userId2, amount: 2000 },
          ],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for empty title", async () => {
      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, title: "" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for amount 0", async () => {
      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, amount: 0 }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when splits have duplicate userId", async () => {
      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validBody,
          splits: [{ userId: userId1 }, { userId: userId1 }],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when custom split total does not match amount", async () => {
      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...validBody,
          splitType: "custom",
          splits: [
            { userId: userId1, amount: 300 },
            { userId: userId2, amount: 300 },
          ],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when lineItem amount rounds to 0 minor units", async () => {
      // $0.004 rounds to 0 cents in minor units; the service must reject it so that
      // a positive major-unit input cannot silently be stored as a zero-cent line item.
      mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: userId1 }]);
      mockCountQuery(0);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Coffee",
          amount: 0.004,
          currency: "USD",
          exchangeRate: 150,
          paidByUserId: userId1,
          splitType: "itemized",
          splits: [{ userId: userId1, amount: 0.004 }],
          lineItems: [{ name: "Coffee", amount: 0.004, memberIds: [userId1] }],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when custom split amount rounds to 0 minor units", async () => {
      // $0.001 rounds to 0 cents; the service must reject it before DB insert.
      mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: userId1 }]);
      mockCountQuery(0);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Coffee",
          amount: 0.001,
          currency: "USD",
          exchangeRate: 150,
          paidByUserId: userId1,
          splitType: "custom",
          splits: [{ userId: userId1, amount: 0.001 }],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when paidByUserId is not a member", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: userId2 }]);
      mockCountQuery(0);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(400);
    });

    it("returns 409 when expense limit reached", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockCountQuery(MAX_EXPENSES_PER_TRIP);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(409);
    });

    it("returns 404 for viewer", async () => {
      setupAuth("viewer");

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(404);
    });

    it("creates expense with category", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockCountQuery(0);
      mockDbInsert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValueOnce([
                { id: "exp-1", ...validBody, category: "transportation", createdAt: new Date() },
              ]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, category: "transportation" }),
      });

      expect(res.status).toBe(201);
    });

    it("creates expense without category", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockCountQuery(0);
      mockDbInsert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValueOnce([{ id: "exp-1", ...validBody, createdAt: new Date() }]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(201);
    });

    it("returns 400 for invalid category", async () => {
      const res = await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validBody, category: "invalid_category" }),
      });

      expect(res.status).toBe(400);
    });

    // The cap count must run inside the transaction (behind the advisory
    // lock), or two concurrent creates can both pass the cap and exceed it.
    it("checks the expense limit inside the transaction", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockCountQuery(0);
      mockDbInsert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValueOnce([{ id: "exp-1", ...validBody, createdAt: new Date() }]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        });

      await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(mockTxSelect).toHaveBeenCalledTimes(1);
    });

    it("POST: 経費作成時に splits の他ユーザーに createNotification を呼ぶ", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockCountQuery(0);
      mockDbInsert
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi
              .fn()
              .mockResolvedValueOnce([{ id: "exp-1", ...validBody, createdAt: new Date() }]),
          }),
        })
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        });

      await makeApp().request(`/api/trips/${tripId}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validBody),
      });

      expect(mockNotifyUsers).toHaveBeenCalledWith(
        expect.objectContaining({ type: "expense_added" }),
      );
    });
  });

  describe("PATCH /api/trips/:tripId/expenses/:expenseId", () => {
    it("updates expense title", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        title: "Old title",
        amount: 1000,
        splitType: "equal",
      });
      const updatedExpense = { id: "exp-1", title: "New title", amount: 1000 };
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedExpense]),
          }),
        }),
      });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New title" }),
      });

      expect(res.status).toBe(200);
      // lineItems should NOT be deleted when only title changes (1 call is auto-reset of settlement payments)
      expect(mockDbDelete).toHaveBeenCalledTimes(1);
    });

    it("updates expense with splits in transaction", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        title: "Dinner",
        amount: 1000,
        splitType: "equal",
      });
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      const updatedExpense = { id: "exp-1", title: "Dinner", amount: 2000 };
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedExpense]),
          }),
        }),
      });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: 2000,
          splitType: "equal",
          splits: [{ userId: userId1 }, { userId: userId2 }],
        }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 400 when paidByUserId is not a member", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        title: "Dinner",
        amount: 1000,
        splitType: "equal",
      });
      mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: userId2 }]);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paidByUserId: userId1 }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when split user is not a member", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        title: "Dinner",
        amount: 1000,
        splitType: "equal",
      });
      mockDbQuery.tripMembers.findMany.mockResolvedValue([{ userId: userId1 }]);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splits: [{ userId: userId1 }, { userId: userId2 }],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("updates expense category", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        title: "Taxi",
        amount: 2000,
        splitType: "equal",
        category: null,
      });
      const updatedExpense = {
        id: "exp-1",
        title: "Taxi",
        amount: 2000,
        category: "transportation",
      };
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedExpense]),
          }),
        }),
      });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "transportation" }),
      });

      expect(res.status).toBe(200);
    });

    it("clears expense category by sending null", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        title: "Taxi",
        amount: 2000,
        splitType: "equal",
        category: "transportation",
      });
      const updatedExpense = { id: "exp-1", title: "Taxi", amount: 2000, category: null };
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedExpense]),
          }),
        }),
      });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: null }),
      });

      expect(res.status).toBe(200);
    });

    it("returns 404 for non-existent expense", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue(null);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/non-existent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New title" }),
      });

      expect(res.status).toBe(404);
    });

    it("updates itemized expense line items", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        title: "居酒屋",
        amount: 5000,
        splitType: "itemized",
      });
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      const updatedExpense = { id: "exp-1", title: "居酒屋", amount: 6000 };
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedExpense]),
          }),
        }),
      });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });
      mockDbInsert
        // splits bulk insert
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        })
        // lineItems bulk insert + returning
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValueOnce([
              { id: "li-1", sortOrder: 0 },
              { id: "li-2", sortOrder: 1 },
            ]),
          }),
        })
        // lineItemMembers bulk insert
        .mockReturnValueOnce({
          values: vi.fn().mockResolvedValueOnce(undefined),
        });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "居酒屋",
          amount: 6000,
          splitType: "itemized",
          splits: [
            { userId: userId1, amount: 4000 },
            { userId: userId2, amount: 2000 },
          ],
          lineItems: [
            { name: "料理", amount: 4000, memberIds: [userId1, userId2] },
            { name: "ソフトドリンク", amount: 2000, memberIds: [userId2] },
          ],
        }),
      });

      expect(res.status).toBe(200);
      // delete is called 3 times: splits, lineItems, and auto-reset of settlement payments
      expect(mockDbDelete).toHaveBeenCalledTimes(3);
    });

    it("amount のみ更新で既存 splits 合計と不一致の場合 400 を返す", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        amount: 1000,
        splitType: "custom",
      });
      // biome-ignore lint/suspicious/noExplicitAny: dynamic mock property addition
      (mockDbQuery as any).expenseSplits = {
        findMany: vi.fn().mockResolvedValue([
          { userId: userId1, amount: 600 },
          { userId: userId2, amount: 400 },
        ]),
      };

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // amount のみ変更, splits なし → 既存 splits 合計 1000 ≠ 新 amount 2000
        body: JSON.stringify({ amount: 2000 }),
      });

      expect(res.status).toBe(400);
    });

    it("splits のみ更新で既存 amount と合計不一致の場合 400 を返す", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        amount: 1000,
        splitType: "custom",
      });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splitType: "custom",
          splits: [
            { userId: userId1, amount: 700 },
            { userId: userId2, amount: 500 },
          ],
        }),
      });

      expect(res.status).toBe(400);
    });

    it("splits のみ更新で USD major-unit splits が minor units に変換され既存 amount と一致する場合 200 を返す", async () => {
      // Regression test: before the fix, 5.5 + 4.5 = 10 (major) ≠ 1000 (minor) caused a false 400.
      // After the fix, toMinorUnits(5.5, "USD") + toMinorUnits(4.5, "USD") = 550 + 450 = 1000.
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        amount: 1000,
        currency: "USD",
        splitType: "custom",
      });
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      const updatedExpense = { id: "exp-1", amount: 1000, currency: "USD" };
      mockDbUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([updatedExpense]),
          }),
        }),
      });
      mockDbDelete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
      mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splitType: "custom",
          splits: [
            { userId: userId1, amount: 5.5 },
            { userId: userId2, amount: 4.5 },
          ],
        }),
      });

      expect(res.status).toBe(200);
    });

    it("amount と splits 両方更新で合計不一致の場合 400 を返す", async () => {
      // When both amount and splits are sent, service validates minor-unit consistency.
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        amount: 1000,
        currency: "USD",
        splitType: "custom",
      });
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: userId1 },
        { userId: userId2 },
      ]);
      mockDbQuery.trips.findFirst.mockResolvedValue({ currency: "USD" });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // amount 12.5 USD = 1250 minor, but splits sum 6.25 + 6.30 = 1255 minor → mismatch
        body: JSON.stringify({
          amount: 12.5,
          splitType: "custom",
          splits: [
            { userId: userId1, amount: 6.25 },
            { userId: userId2, amount: 6.3 },
          ],
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /api/trips/:tripId/expenses/:expenseId", () => {
    it("deletes expense and returns 204", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue({
        id: "exp-1",
        tripId,
        title: "Dinner",
        amount: 1000,
      });
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/exp-1`, {
        method: "DELETE",
      });

      expect(res.status).toBe(204);
      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          tripId,
          action: "deleted",
          entityType: "expense",
          entityName: "Dinner",
        }),
      );
    });

    it("returns 404 for non-existent expense", async () => {
      mockDbQuery.expenses.findFirst.mockResolvedValue(null);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/non-existent`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/trips/:tripId/expenses/batch-delete", () => {
    const e1 = "00000000-0000-0000-0000-0000000000a1";
    const e2 = "00000000-0000-0000-0000-0000000000a2";

    it("deletes multiple expenses and resets settlement payments", async () => {
      mockDbQuery.expenses.findMany.mockResolvedValue([{ id: e1 }, { id: e2 }]);

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/batch-delete`, {
        method: "POST",
        body: JSON.stringify({ expenseIds: [e1, e2] }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.deleted).toBe(2);
      // expenses + settlement payments both deleted within the transaction
      expect(mockDbDelete).toHaveBeenCalledTimes(2);
      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: "deleted", entityType: "expense" }),
      );
    });

    it("returns 404 when some ids do not belong to the trip", async () => {
      mockDbQuery.expenses.findMany.mockResolvedValue([{ id: e1 }]); // only one of two found

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/batch-delete`, {
        method: "POST",
        body: JSON.stringify({ expenseIds: [e1, e2] }),
      });

      expect(res.status).toBe(404);
      expect(mockDbDelete).not.toHaveBeenCalled();
    });

    it("blocks viewer role (404 to avoid leaking trip existence)", async () => {
      setupAuth("viewer");

      const res = await makeApp().request(`/api/trips/${tripId}/expenses/batch-delete`, {
        method: "POST",
        body: JSON.stringify({ expenseIds: [e1] }),
      });

      // requireTripAccess("editor") returns 404 (TRIP_NOT_FOUND) when the role is insufficient
      expect(res.status).toBe(404);
      expect(mockDbDelete).not.toHaveBeenCalled();
    });
  });
});
