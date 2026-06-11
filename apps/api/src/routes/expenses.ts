import type { CurrencyCode, ExpenseCategory } from "@sugara/shared";
import {
  batchExpenseIdsSchema,
  createExpenseSchema,
  formatCurrency,
  updateExpenseSchema,
} from "@sugara/shared";
import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { expenses, settlementPayments, tripMembers, trips } from "../db/schema";
import { logActivity } from "../lib/activity-logger";
import { ERROR_MSG } from "../lib/constants";
import { createExpenseCore, updateExpenseCore } from "../lib/expense-service";
import { getParam } from "../lib/params";
import {
  calculateDirectTransfers,
  calculateMemberBurdens,
  calculateSettlement,
  toSettlementExpenses,
} from "../lib/settlement";
import { requireAuth } from "../middleware/auth";
import { requireTripAccess } from "../middleware/require-trip-access";
import type { AppEnv } from "../types";

const expenseRoutes = new Hono<AppEnv>();
expenseRoutes.use("*", requireAuth);

// List expenses with settlement summary
expenseRoutes.get("/:tripId/expenses", requireTripAccess(), async (c) => {
  const tripId = getParam(c, "tripId");

  const [expenseList, members, tripRow] = await Promise.all([
    db.query.expenses.findMany({
      where: eq(expenses.tripId, tripId),
      with: {
        paidByUser: { columns: { id: true, name: true } },
        splits: { with: { user: { columns: { id: true, name: true } } } },
        lineItems: {
          with: { members: { orderBy: (members, { asc }) => [asc(members.userId)] } },
          orderBy: (lineItems, { asc }) => [asc(lineItems.sortOrder)],
        },
      },
      orderBy: (expenses, { desc }) => [desc(expenses.createdAt)],
    }),
    db.query.tripMembers.findMany({
      where: eq(tripMembers.tripId, tripId),
      with: { user: { columns: { id: true, name: true } } },
    }),
    db.query.trips.findFirst({
      where: eq(trips.id, tripId),
      columns: { currency: true },
    }),
  ]);
  const tripCurrency = (tripRow?.currency ?? "JPY") as CurrencyCode;

  const memberInfos = members.map((m) => ({ id: m.user.id, name: m.user.name }));
  const expenseData = toSettlementExpenses(
    expenseList.map((e) => ({
      paidByUserId: e.paidByUserId,
      splitType: e.splitType,
      amount: e.amount,
      baseAmount: e.baseAmount,
      splits: e.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
    })),
  );

  const settlement = {
    ...calculateSettlement(expenseData, memberInfos),
    directTransfers: calculateDirectTransfers(expenseData, memberInfos),
  };

  // Group by category, keeping uncategorized expenses under a null bucket so the
  // category breakdown totals match the grand total. The display label is resolved
  // on the client via i18n (no label is sent here).
  const UNCATEGORIZED = "__uncategorized__";
  const categoryMap = new Map<
    string,
    { category: ExpenseCategory | null; total: number; count: number }
  >();
  for (const e of expenseList) {
    const key = e.category ?? UNCATEGORIZED;
    const existing = categoryMap.get(key) ?? { category: e.category ?? null, total: 0, count: 0 };
    existing.total += e.baseAmount ?? e.amount;
    existing.count += 1;
    categoryMap.set(key, existing);
  }

  const categoryTotals = Array.from(categoryMap.values()).map((data) => ({
    category: data.category,
    total: data.total,
    count: data.count,
  }));

  const memberTotals = calculateMemberBurdens(
    expenseList.map((e) => ({
      splitType: e.splitType,
      amount: e.amount,
      baseAmount: e.baseAmount,
      splits: e.splits.map((s) => ({ userId: s.userId, amount: s.amount })),
    })),
    memberInfos,
  );

  const payments = await db.query.settlementPayments.findMany({
    where: eq(settlementPayments.tripId, tripId),
  });

  return c.json({
    tripCurrency,
    expenses: expenseList,
    settlement,
    settlementPayments: payments,
    categoryTotals,
    memberTotals,
  });
});

// Create expense
expenseRoutes.post("/:tripId/expenses", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = createExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const result = await createExpenseCore(tripId, user.id, user.name, parsed.data);

  if (!result.ok) {
    switch (result.error) {
      case "exchange_rate_required":
        return c.json(
          { error: "exchangeRate is required when currency differs from trip currency" },
          400,
        );
      case "limit_reached":
        return c.json({ error: ERROR_MSG.LIMIT_EXPENSES }, 409);
      case "payer_not_member":
        return c.json({ error: ERROR_MSG.EXPENSE_PAYER_NOT_MEMBER }, 400);
      case "split_user_not_member":
        return c.json({ error: ERROR_MSG.EXPENSE_SPLIT_USER_NOT_MEMBER }, 400);
      case "amount_below_minor_unit":
        return c.json({ error: ERROR_MSG.EXPENSE_AMOUNT_BELOW_MINOR_UNIT }, 400);
    }
  }

  return c.json(result.expense, 201);
});

// Update expense
expenseRoutes.patch("/:tripId/expenses/:expenseId", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const expenseId = getParam(c, "expenseId");

  const body = await c.req.json();
  const parsed = updateExpenseSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const result = await updateExpenseCore(tripId, expenseId, user.id, parsed.data);

  if (!result.ok) {
    switch (result.error) {
      case "not_found":
        return c.json({ error: ERROR_MSG.EXPENSE_NOT_FOUND }, 404);
      case "exchange_rate_required":
        return c.json(
          { error: "exchangeRate is required when currency differs from trip currency" },
          400,
        );
      case "payer_not_member":
        return c.json({ error: ERROR_MSG.EXPENSE_PAYER_NOT_MEMBER }, 400);
      case "split_user_not_member":
        return c.json({ error: ERROR_MSG.EXPENSE_SPLIT_USER_NOT_MEMBER }, 400);
      case "split_amount_mismatch":
        return c.json({ error: ERROR_MSG.EXPENSE_SPLIT_AMOUNT_MISMATCH }, 400);
      case "itemized_no_line_items":
        return c.json({ error: "Itemized split requires line items" }, 400);
      case "amount_below_minor_unit":
        return c.json({ error: ERROR_MSG.EXPENSE_AMOUNT_BELOW_MINOR_UNIT }, 400);
    }
  }

  return c.json(result.expense);
});

// Delete expense
expenseRoutes.delete("/:tripId/expenses/:expenseId", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");
  const expenseId = getParam(c, "expenseId");

  const existing = await db.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
  });

  if (!existing || existing.tripId !== tripId) {
    return c.json({ error: ERROR_MSG.EXPENSE_NOT_FOUND }, 404);
  }

  await db.transaction(async (tx) => {
    await tx.delete(expenses).where(eq(expenses.id, expenseId));
    // Auto-reset settlement payments when expenses change
    await tx.delete(settlementPayments).where(eq(settlementPayments.tripId, tripId));
  });

  logActivity({
    tripId,
    userId: user.id,
    action: "deleted",
    entityType: "expense",
    entityName: existing.title,
    detail: formatCurrency(existing.amount, (existing.currency ?? "JPY") as CurrencyCode, "ja"),
  });

  return c.body(null, 204);
});

// Batch delete expenses
expenseRoutes.post("/:tripId/expenses/batch-delete", requireTripAccess("editor"), async (c) => {
  const user = c.get("user");
  const tripId = getParam(c, "tripId");

  const body = await c.req.json();
  const parsed = batchExpenseIdsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const { expenseIds } = parsed.data;

  const owned = await db.query.expenses.findMany({
    where: and(inArray(expenses.id, expenseIds), eq(expenses.tripId, tripId)),
    columns: { id: true },
  });
  if (owned.length !== expenseIds.length) {
    return c.json({ error: ERROR_MSG.EXPENSE_NOT_FOUND }, 404);
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(expenses)
      .where(and(inArray(expenses.id, expenseIds), eq(expenses.tripId, tripId)));
    // Auto-reset settlement payments when expenses change
    await tx.delete(settlementPayments).where(eq(settlementPayments.tripId, tripId));
  });

  logActivity({
    tripId,
    userId: user.id,
    action: "deleted",
    entityType: "expense",
    detail: `${expenseIds.length}件`,
  });

  return c.json({ ok: true, deleted: expenseIds.length });
});

export { expenseRoutes };
