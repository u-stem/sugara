import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSession, mockDbQuery, mockDbInsert, mockDbDelete, mockNotifyUsers } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockDbQuery: {
      expenses: { findMany: vi.fn() },
      tripMembers: { findFirst: vi.fn(), findMany: vi.fn() },
      trips: { findFirst: vi.fn() },
      settlementPayments: { findFirst: vi.fn(), findMany: vi.fn() },
    },
    mockDbInsert: vi.fn(),
    mockDbDelete: vi.fn(),
    mockNotifyUsers: vi.fn(),
  }),
);

vi.mock("../lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

vi.mock("../db/index", () => ({
  db: {
    query: mockDbQuery,
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  },
}));

vi.mock("../lib/activity-logger", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/notifications", () => ({
  notifyUsers: (...args: unknown[]) => mockNotifyUsers(...args),
}));

vi.mock("../lib/settlement", () => ({
  calculateSettlement: vi.fn().mockReturnValue({
    totalAmount: 1000,
    balances: [],
    transfers: [
      {
        from: { id: "00000000-0000-0000-0000-000000000001", name: "From" },
        to: { id: "00000000-0000-0000-0000-000000000002", name: "To" },
        amount: 500,
      },
    ],
  }),
  toSettlementExpenses: vi.fn((expenses) => expenses),
}));

import { logActivity } from "../lib/activity-logger";
import { toSettlementExpenses } from "../lib/settlement";
import { settlementPaymentRoutes, unsettledSummaryRoutes } from "../routes/settlement-payments";
import { createTestApp, TEST_USER } from "./test-helpers";

const tripId = "trip-1";
const fromUserId = "00000000-0000-0000-0000-000000000001";
const toUserId = "00000000-0000-0000-0000-000000000002";

function setupAuth(userId = TEST_USER.id, role: "owner" | "editor" | "viewer" = "owner") {
  mockGetSession.mockResolvedValue({
    user: { ...TEST_USER, id: userId },
    session: { id: "session-1" },
  });
  mockDbQuery.tripMembers.findFirst.mockResolvedValue({
    tripId,
    userId,
    role,
  });
}

function makeApp() {
  return createTestApp(settlementPaymentRoutes, "/api/trips");
}

function makeUnsettledApp() {
  return createTestApp(unsettledSummaryRoutes, "/api/users");
}

describe("Settlement payment routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth(fromUserId);
    mockDbQuery.trips.findFirst.mockResolvedValue({ title: "テスト旅行" });
  });

  describe("POST /api/trips/:tripId/settlement-payments", () => {
    it("creates a settlement payment", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: fromUserId, user: { id: fromUserId, name: "From" } },
        { userId: toUserId, user: { id: toUserId, name: "To" } },
      ]);
      mockDbQuery.expenses.findMany.mockResolvedValue([]);
      const payment = {
        id: "sp-1",
        tripId,
        fromUserId,
        toUserId,
        amount: 500,
        paidAt: new Date().toISOString(),
        paidByUserId: fromUserId,
      };
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([payment]),
        }),
      });

      const res = await makeApp().request(`/api/trips/${tripId}/settlement-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId, toUserId, amount: 500 }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.fromUserId).toBe(fromUserId);
      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: "settle", entityType: "settlement" }),
      );
      expect(mockNotifyUsers).toHaveBeenCalled();
    });

    it("rejects if caller is not from or to user", async () => {
      setupAuth("other-user-id");
      mockDbQuery.tripMembers.findMany.mockResolvedValue([]);
      mockDbQuery.expenses.findMany.mockResolvedValue([]);

      const res = await makeApp().request(`/api/trips/${tripId}/settlement-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId, toUserId, amount: 500 }),
      });

      expect(res.status).toBe(403);
    });

    it("rejects invalid body", async () => {
      const res = await makeApp().request(`/api/trips/${tripId}/settlement-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId: "not-uuid" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 409 on duplicate", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: fromUserId, user: { id: fromUserId, name: "From" } },
        { userId: toUserId, user: { id: toUserId, name: "To" } },
      ]);
      mockDbQuery.expenses.findMany.mockResolvedValue([]);
      const uniqueError = Object.assign(new Error("duplicate key"), { code: "23505" });
      mockDbInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(uniqueError),
        }),
      });

      const res = await makeApp().request(`/api/trips/${tripId}/settlement-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId, toUserId, amount: 500 }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe("DELETE /api/trips/:tripId/settlement-payments/:id", () => {
    it("deletes a settlement payment", async () => {
      mockDbQuery.settlementPayments.findFirst.mockResolvedValue({
        id: "sp-1",
        tripId,
        fromUserId,
        toUserId,
        amount: 500,
        paidByUserId: fromUserId,
      });
      mockDbQuery.tripMembers.findMany.mockResolvedValue([
        { userId: fromUserId, user: { id: fromUserId, name: "From" } },
        { userId: toUserId, user: { id: toUserId, name: "To" } },
      ]);
      mockDbDelete.mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      const res = await makeApp().request(`/api/trips/${tripId}/settlement-payments/sp-1`, {
        method: "DELETE",
      });

      expect(res.status).toBe(204);
      expect(logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: "unsettle", entityType: "settlement" }),
      );
    });

    it("returns 404 for non-existent payment", async () => {
      mockDbQuery.settlementPayments.findFirst.mockResolvedValue(null);

      const res = await makeApp().request(`/api/trips/${tripId}/settlement-payments/sp-missing`, {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("rejects if caller is not from or to user", async () => {
      setupAuth("other-user-id");
      mockDbQuery.settlementPayments.findFirst.mockResolvedValue({
        id: "sp-1",
        tripId,
        fromUserId,
        toUserId,
        amount: 500,
        paidByUserId: fromUserId,
      });

      const res = await makeApp().request(`/api/trips/${tripId}/settlement-payments/sp-1`, {
        method: "DELETE",
      });

      expect(res.status).toBe(403);
    });
  });
});

describe("Unsettled summary routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth(fromUserId);
  });

  describe("GET /api/users/:userId/unsettled-summary", () => {
    it("returns empty summary when no unsettled transfers", async () => {
      mockDbQuery.tripMembers.findMany.mockResolvedValue([]);

      const res = await makeUnsettledApp().request(`/api/users/${fromUserId}/unsettled-summary`);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.totalOwed).toBe(0);
      expect(json.totalOwedTo).toBe(0);
      expect(json.trips).toEqual([]);
    });

    it("rejects if userId does not match caller", async () => {
      const res = await makeUnsettledApp().request(`/api/users/other-user/unsettled-summary`);

      expect(res.status).toBe(403);
    });

    it("routes expense data through toSettlementExpenses for foreign-currency custom splits", async () => {
      // Before the fix the unsettled summary used a raw mapping (no toSettlementExpenses call),
      // causing foreign custom/itemized splits to be passed without trip-currency conversion.
      // This test verifies the fix: toSettlementExpenses must be called with the full expense
      // data including splitType so it can dispatch resolveBurdens correctly.
      mockDbQuery.tripMembers.findMany
        .mockResolvedValueOnce([
          { userId: fromUserId, trip: { id: tripId, title: "Trip", currency: "JPY" } },
        ])
        .mockResolvedValueOnce([
          { userId: fromUserId, user: { id: fromUserId, name: "From" } },
          { userId: toUserId, user: { id: toUserId, name: "To" } },
        ]);
      mockDbQuery.expenses.findMany.mockResolvedValue([
        {
          id: "exp-1",
          paidByUserId: fromUserId,
          splitType: "custom",
          amount: 1250,
          baseAmount: 1400,
          splits: [
            { userId: fromUserId, amount: 625 },
            { userId: toUserId, amount: 625 },
          ],
        },
      ]);
      mockDbQuery.settlementPayments.findMany.mockResolvedValue([]);

      const res = await makeUnsettledApp().request(`/api/users/${fromUserId}/unsettled-summary`);

      expect(res.status).toBe(200);
      expect(vi.mocked(toSettlementExpenses)).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ splitType: "custom" })]),
      );
    });
  });
});
